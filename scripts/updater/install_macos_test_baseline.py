#!/usr/bin/env python3
"""Fresh-install a verified local-test release in the owned test namespace only."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import time


def code_hash(app):
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
    details = subprocess.run(['codesign', '-dv', '--verbose=4', str(app)],
                             capture_output=True, text=True, check=True).stderr
    return re.search(r'^CDHash=(.+)$', details, re.M).group(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', type=Path, required=True)
    parser.add_argument('--verify-installed', action='store_true', help='Resume checks without resetting an installed baseline')
    parser.add_argument('--backup-name', default='before-corrected-baseline')
    parser.add_argument('--preserve-controller', action='store_true',
                        help='Retain a normally bootstrapped controller for a repeated upgrade test')
    parser.add_argument('--restore-profile', type=Path,
                        help='Restore a closed baseline profile from this test namespace')
    parser.add_argument('--stage', default='corrected-baseline-verification')
    parser.add_argument('--prepare-only', action='store_true',
                        help='Prepare a repeat test without opening About or triggering an update check')
    args = parser.parse_args()
    if args.prepare_only and not args.preserve_controller:
        parser.error('prepare-only requires an already installed test controller')
    if sys.platform != 'darwin':
        parser.error('macOS required')
    root = Path.home() / 'chromium/updater-test'
    if Path(args.backup_name).name != args.backup_name or args.backup_name in ('.', '..'):
        parser.error('backup-name must be a single directory name')
    if Path(args.stage).name != args.stage or args.stage in ('.', '..'):
        parser.error('stage must be a single directory name')
    if args.restore_profile:
        profile_source = args.restore_profile.resolve()
        if not profile_source.is_relative_to(root.resolve()) or not (profile_source / 'Local State').is_file():
            raise RuntimeError('Restore only a saved profile within the owned test namespace')
    if json.loads((root / 'catalog.json').read_text()).get('apps') != []:
        raise RuntimeError('Empty the isolated test catalog before resetting the baseline')
    release = args.release.resolve()
    manifest = json.loads((release / 'release-manifest.json').read_text())
    if (manifest['update_channel'] not in ('local-test', 'cloud-test') or manifest['architecture'] != 'arm64' or
            manifest['notarization'] != 'accepted and stapled' or manifest['gatekeeper'] != 'accepted'):
        raise RuntimeError('Use a verified, notarized isolated ARM64 test release')
    dmg = release / 'artifacts' / manifest['dmg']
    if dmg.parent != release / 'artifacts':
        raise RuntimeError('Invalid release filename')
    with dmg.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != manifest['sha256']:
            raise RuntimeError('Release DMG hash mismatch')
    app = root / 'install/Browser Operator.app'
    controller = Path.home() / 'Library/Application Support/BrowserOperatorUpdateTest/BrowserOperatorUpdaterTest'
    current = controller / 'Current'
    if not args.verify_installed:
        backup = root / (args.backup_name + '.noindex')
        backup.mkdir()  # Preserve earlier evidence; never overwrite a reset backup.
        if current.exists() and not args.preserve_controller:
            if not current.resolve().is_relative_to(controller.resolve()):
                raise RuntimeError('Test controller link escapes its owned namespace')
            helper = current / 'BrowserOperatorUpdaterTest.app'
            info = plistlib.loads((helper / 'Contents/Info.plist').read_bytes())
            if info['CFBundleIdentifier'] != 'com.browseroperator.autoupdate-test.Updater':
                raise RuntimeError('Refusing to uninstall a different updater')
            code_hash(helper)
            shutil.copytree(controller, backup / 'controller', symlinks=True)
            with (backup / 'uninstall.log').open('w') as log:
                subprocess.run([str(helper / 'Contents/MacOS/BrowserOperatorUpdaterTest'),
                                '--uninstall', '--enable-logging', '--v=1'],
                               check=True, timeout=120, stdout=log, stderr=subprocess.STDOUT)
            if current.exists():
                raise RuntimeError('Old test controller still exists after uninstall')
        if app.exists():
            app.rename(backup / 'Browser Operator.app')
        mounted = plistlib.loads(subprocess.check_output([
            'hdiutil', 'attach', '-readonly', '-nobrowse', '-plist', str(dmg)]))
        volume = next(Path(e['mount-point']) for e in mounted['system-entities'] if 'mount-point' in e)
        try:
            subprocess.run(['cp', '-cR', str(volume / app.name), str(app)], check=True)
        finally:
            subprocess.run(['hdiutil', 'detach', str(volume)], check=True)
        if args.restore_profile:
            profile = root / 'profile'
            if profile.exists():
                profile.rename(backup / 'profile')
            shutil.copytree(profile_source, profile, symlinks=True)
        if args.preserve_controller:
            ksadmin = current / ('BrowserOperatorUpdaterTest.app/Contents/Helpers/'
                'BrowserOperatorUpdateTestSoftwareUpdate.bundle/Contents/Helpers/ksadmin')
            subprocess.run([str(ksadmin), '-r', '-P', 'com.browseroperator.BrowserOperator',
                            '-v', manifest['version'], '-x', str(app), '-U'], check=True)
    code_hash(app)
    subprocess.run(['xcrun', 'stapler', 'validate', str(app)], check=True)
    subprocess.run(['spctl', '--assess', '--type', 'execute', str(app)], check=True)
    if args.prepare_only:
        (root / args.stage).mkdir(exist_ok=True)
    else:
        subprocess.run([sys.executable, str(Path(__file__).with_name('probe_macos_baseline.py')),
                        '--version', manifest['version'], '--profile-sentinel', 'check',
                        '--launch-via-services',
                        '--stage', args.stage], check=True)
    # This check must pass without manually clearing quarantine or bootstrapping.
    label = 'com.browseroperator.autoupdate-test.Updater.wake'
    agent = Path.home() / 'Library/LaunchAgents' / (label + '.plist')
    attributes = subprocess.check_output(['/usr/bin/xattr', str(agent)], text=True).splitlines() if agent.is_file() else []
    if not agent.is_file() or 'com.apple.quarantine' in attributes:
        raise RuntimeError('Fresh wake agent is absent or still quarantined')
    state = subprocess.check_output(['launchctl', 'print', f'gui/{os.getuid()}/{label}'], text=True)
    (root / args.stage / 'launch-agent.txt').write_text(state)
    installed = current / 'BrowserOperatorUpdaterTest.app'
    embedded = app / 'Contents/Frameworks/Browser Operator Framework.framework/Versions/Current/Helpers/BrowserOperatorUpdaterTest.app'
    expected = code_hash(embedded)
    if code_hash(installed) != expected:
        raise RuntimeError('Installed helper differs from the corrected notarized helper')
    # Register's RPC can return before its asynchronous prefs commit reaches disk.
    for _ in range(40):
        prefs = json.loads((controller / 'prefs.json').read_text())
        registration = prefs['updateclientdata']['apps']['com.browseroperator.browseroperator']
        if Path(registration['ecp']) == app and registration['pv'] == manifest['version']:
            break
        time.sleep(.25)
    else:
        raise RuntimeError('Test browser registration has wrong path or version')
    report = {'version': manifest['version'], 'release_sha256': manifest['sha256'],
              'installed_helper_cdhash': expected,
              'native_about_check': 'pending interactive check' if args.prepare_only else 'passed',
              'fresh_launch_agent': 'passed', 'manual_quarantine_repair': False,
              'registered_browser_path': str(app)}
    (root / (args.stage + '-install.json')).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
