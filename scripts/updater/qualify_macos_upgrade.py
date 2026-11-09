#!/usr/bin/env python3
"""Exercise the real native updater in the owned macOS qualification install."""

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import signal
import socket
import subprocess
import sys
import time

from omaha_checkout import load_service


ROOT = Path.home() / 'chromium/updater-test'
APP = ROOT / 'install/Browser Operator.app'
SCRIPTS = Path(__file__).resolve().parent


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def snapshot():
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(APP)], check=True)
    info = plistlib.loads((APP / 'Contents/Info.plist').read_bytes())
    details = subprocess.run(['codesign', '-dv', '--verbose=4', str(APP)],
                             capture_output=True, text=True, check=True).stderr
    framework = APP / 'Contents/Frameworks/Browser Operator Framework.framework/Versions/Current/Browser Operator Framework'
    return {'version': info['CFBundleShortVersionString'],
            'cdhash': re.search(r'^CDHash=(.+)$', details, re.M).group(1),
            'executable_sha256': digest(APP / 'Contents/MacOS/Browser Operator'),
            'framework_sha256': digest(framework)}


def atomic_catalog(value):
    pending = ROOT / 'catalog.pending.json'
    pending.write_text(json.dumps(value, indent=2) + '\n')
    pending.replace(ROOT / 'catalog.json')


@contextmanager
def service(fault, run, omaha_source, openssl):
    with (run / f'{fault}-service.log').open('w') as log:
        child = subprocess.Popen([
            sys.executable, '-m', 'omaha.service',
            '--catalog', str(ROOT / 'catalog.json'), '--artifacts', str(ROOT / 'artifacts'),
            '--cup-key', str(Path.home() / 'chromium/browser-operator-updater-private/test-keys/cup.pem'),
            '--fault', fault, '--openssl', openssl,
        ], cwd=omaha_source, stdout=log, stderr=subprocess.STDOUT)
        try:
            for _ in range(100):
                if child.poll() is not None:
                    raise RuntimeError('Owned update service exited during startup')
                try:
                    with socket.create_connection(('127.0.0.1', 18158), timeout=.25):
                        break
                except OSError:
                    time.sleep(.1)
            else:
                raise RuntimeError('Owned update service did not listen')
            yield
        finally:
            if child.poll() is None:
                child.send_signal(signal.SIGINT)
                try:
                    child.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    child.terminate()
                    child.wait(timeout=15)


def probe(expected_version, status, stage, log):
    with log.open('w') as stream:
        subprocess.run([sys.executable, str(SCRIPTS / 'probe_macos_baseline.py'),
                        '--version', expected_version, '--status', status,
                        '--profile-sentinel', 'check', '--launch-via-services', '--stage', stage],
                       check=True, timeout=240, stdout=stream, stderr=subprocess.STDOUT)


def periodic_update(controller, target, run):
    """Trigger the installed launchd job, rather than an RPC from the shell.

    macOS attributes a command-line utility's RPC differently from the browser
    and scheduled launchd agent. Only this disposable controller's timestamps
    are reset to simulate a due check; no policies or OS permissions change.
    """
    for _ in range(90):
        processes = subprocess.check_output(['ps', '-axo', 'command='], text=True)
        active = [line for line in processes.splitlines()
                  if line.startswith(str(controller) + '/')]
        if not active:
            break
        time.sleep(1)
    else:
        raise RuntimeError('Test controller must be idle before adjusting its test clock')
    prefs = controller / 'prefs.json'
    shutil.copy2(prefs, run / 'before-periodic-wake-prefs.json')
    values = json.loads(prefs.read_text())
    values['last_checked'] = '0'
    values['last_started'] = '0'
    prefs.write_text(json.dumps(values))
    subprocess.run(['launchctl', 'kickstart',
                    f'gui/{os.getuid()}/com.browseroperator.autoupdate-test.Updater.wake'], check=True)
    for _ in range(300):
        info = plistlib.loads((APP / 'Contents/Info.plist').read_bytes())
        if info['CFBundleShortVersionString'] == target:
            try:
                if snapshot()['version'] == target:
                    break
            except subprocess.CalledProcessError:
                pass  # The installer can still be atomically replacing files.
        time.sleep(1)
    else:
        raise RuntimeError('Scheduled native update did not install the target version')
    shutil.copy2(controller / 'updater.log', run / 'periodic-updater.log')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', required=True, type=Path)
    parser.add_argument('--omaha-src', required=True, type=Path,
                        help='Pinned private BrowserOperator/omaha checkout; see README.md')
    parser.add_argument('--openssl', default=shutil.which('openssl'))
    parser.add_argument('--baseline-version', default='158.0.8127.18')
    parser.add_argument('--run-name', default='local-upgrade-qualification')
    args = parser.parse_args()
    if Path(args.run_name).name != args.run_name or args.run_name in ('.', '..'):
        parser.error('run-name must be a single directory name')
    if sys.platform != 'darwin':
        parser.error('macOS required')
    # Never take over an arbitrary process or an active candidate service.
    with socket.socket() as port:
        port.bind(('127.0.0.1', 18158))
    if json.loads((ROOT / 'catalog.json').read_text()).get('apps') != []:
        raise RuntimeError('Start with an empty isolated catalog')
    omaha_source = args.omaha_src.resolve()
    server_module = load_service(omaha_source)
    load_catalog, version = server_module.load_catalog, server_module.version
    candidate = args.candidate.resolve()
    catalog = load_catalog(candidate / 'catalog-candidate.json', candidate)
    if len(catalog['apps']) != 1 or catalog['apps'][0]['appid'].lower() != 'com.browseroperator.browseroperator':
        raise RuntimeError('Expected only the test browser candidate')
    target = catalog['apps'][0]['version']
    if version(target) <= version(args.baseline_version):
        raise RuntimeError('Candidate must be newer than the baseline')
    controller = Path.home() / 'Library/Application Support/BrowserOperatorUpdateTest/BrowserOperatorUpdaterTest'
    registration = json.loads((controller / 'prefs.json').read_text())['updateclientdata']['apps']['com.browseroperator.browseroperator']
    if Path(registration['ecp']) != APP or registration['pv'] != args.baseline_version:
        raise RuntimeError('Updater registration must point ONLY to the baseline test install')
    before = snapshot()
    if before['version'] != args.baseline_version:
        raise RuntimeError('Installed test app is not the baseline')
    baseline_bookmark = json.loads((ROOT / 'corrected-baseline-verification/profile-sentinel.json').read_text())['bookmark']
    run = ROOT / args.run_name
    run.mkdir()  # Earlier evidence is never overwritten.
    (run / 'before.json').write_text(json.dumps(before, indent=2) + '\n')
    shutil.copytree(ROOT / 'profile', run / 'profile-before', symlinks=True)
    package = catalog['apps'][0]['crx']['name']
    destination = ROOT / 'artifacts' / package
    if destination.exists():
        if digest(destination) != catalog['apps'][0]['crx']['sha256']:
            raise RuntimeError('Existing candidate artifact has a different hash')
    else:
        subprocess.run(['cp', '-c', str(candidate / package), str(destination)], check=True)
    load_catalog(candidate / 'catalog-candidate.json', ROOT / 'artifacts')
    try:
        atomic_catalog(catalog)
        stages = {fault: args.run_name + '-' + fault
                  for fault in ('invalid-cup', 'corrupt-download')}
        stages['post-upgrade'] = args.run_name + '-post-upgrade'
        for fault in ('invalid-cup', 'corrupt-download'):
            stage = stages[fault]
            print(f'Testing native rejection: {fault}', flush=True)
            with service(fault, run, omaha_source, args.openssl):
                probe(args.baseline_version, 'failed', stage, run / f'{fault}-browser.log')
            if snapshot() != before:
                raise RuntimeError(f'{fault} changed the baseline application')
            bookmark = json.loads((ROOT / stage / 'profile-sentinel.json').read_text())['bookmark']
            if bookmark != baseline_bookmark:
                raise RuntimeError(f'{fault} changed the test bookmark')
        print('Testing native background installation', flush=True)
        with service('none', run, omaha_source, args.openssl):
            periodic_update(controller, target, run)
            after = snapshot()
            if after['version'] != target:
                raise RuntimeError('Background update did not install the target version')
            subprocess.run(['xcrun', 'stapler', 'validate', str(APP)], check=True)
            subprocess.run(['spctl', '--assess', '--type', 'execute', str(APP)], check=True)
            probe(target, 'updated', stages['post-upgrade'], run / 'post-upgrade-browser.log')
        bookmark = json.loads((ROOT / stages['post-upgrade'] / 'profile-sentinel.json').read_text())['bookmark']
        if bookmark != baseline_bookmark:
            raise RuntimeError('Upgrade changed the test bookmark identity')
        report = {'baseline': before, 'installed': after,
                  'invalid_cup_rejection': 'passed', 'corrupt_download_rejection': 'passed',
                  'background_upgrade': 'passed', 'running_target_version': target,
                  'profile_bookmark_preserved': True, 'bookmark': bookmark,
                  'candidate': json.loads((candidate / 'update-manifest.json').read_text()),
                  'native_toolbar_ui_test': 'pending', 'probe_artifact_dirs': stages}
        (run / 'qualification-report.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report, indent=2), flush=True)
    finally:
        atomic_catalog({'channel': 'autoupdate-test', 'apps': []})


if __name__ == '__main__':
    main()
