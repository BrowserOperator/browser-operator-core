#!/usr/bin/env python3
"""Sign, notarize, package, and test a Chromium ARM64 shipping DMG.

Uses Chromium's generated nested-signing pipeline and the existing project's
notarytool keychain profile. Never modifies the input app or deletes a release.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shlex
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request


def run(command, **kwargs):
    print('+', ' '.join(map(str, command)), flush=True)
    return subprocess.run(list(map(str, command)), check=True, **kwargs)


def gn_configuration_digests(build):
    # GN's depfile includes imports, including the external frontend config.
    # Cache their hashes so a manually rebuilt, changed config cannot reuse
    # release settings captured from an earlier build.
    inputs = shlex.split((build / 'build.ninja.d').read_text().replace('\\\n', ''))
    return {name: hashlib.sha256((build / name).read_bytes()).hexdigest()
            for name in inputs if name.endswith(('.gn', '.gni'))}


def capture_shipping_settings(source, build):
    """Inspect GN before Ninja; GN inspection can invalidate generated resources."""
    output = subprocess.check_output(
        [str(source / 'buildtools/mac/gn'), 'args', str(build), '--list', '--short'],
        cwd=source, text=True)
    values = dict(line.split(' = ', 1) for line in output.splitlines() if ' = ' in line)
    selected = validate_shipping_settings(values, values.get('enable_updater') == 'true')
    metadata = {
        'source_revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip(),
        'gn_args_sha256': hashlib.sha256((build / 'args.gn').read_bytes()).hexdigest(),
        'settings': selected,
        'configuration_inputs': gn_configuration_digests(build),
    }
    (build / 'browser-operator-build-settings.json').write_text(json.dumps(metadata, indent=2) + '\n')
    return selected


def shipping_args(source, build, updater_enabled=False):
    cache = build / 'browser-operator-build-settings.json'
    if cache.exists():
        metadata = json.loads(cache.read_text())
        revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()
        if (metadata['source_revision'] != revision or metadata['gn_args_sha256'] !=
                hashlib.sha256((build / 'args.gn').read_bytes()).hexdigest() or
                metadata.get('configuration_inputs') != gn_configuration_digests(build)):
            raise RuntimeError('Build settings are stale; rerun build_chromium_release.py')
        values = metadata['settings']
    else:
        values = capture_shipping_settings(source, build)
    return validate_shipping_settings(values, updater_enabled)


def validate_shipping_settings(values, updater_enabled=False):
    expected = {
        'is_official_build': 'true', 'is_debug': 'false',
        'is_component_build': 'false', 'dcheck_always_on': 'false',
        'chrome_pgo_phase': '2', 'devtools_bundle': 'true',
        'devtools_skip_typecheck': 'false', 'target_cpu': '"arm64"',
        'is_chrome_branded': 'false', 'enable_updater': 'true' if updater_enabled else 'false',
    }
    for key, value in expected.items():
        if values.get(key) != value:
            raise RuntimeError(f'Refusing to package non-shipping settings: {key}={values.get(key)}')
    return {**{key: values[key] for key in expected},
            'use_thin_lto': values.get('use_thin_lto'),
            'browser_operator_updater_config': values.get('browser_operator_updater_config', '""')}


def find_identity(requested):
    identities = subprocess.check_output(['security', 'find-identity', '-v', '-p', 'codesigning'], text=True)
    matches = re.findall(r'\b([A-Fa-f0-9]{40}) "(Developer ID Application:[^"]+)"', identities)
    if requested:
        matches = [entry for entry in matches if requested in entry]
    if len(matches) != 1:
        raise RuntimeError('Specify --identity matching exactly one valid Developer ID Application identity')
    fingerprint, name = matches[0]
    team = re.search(r'\(([A-Z0-9]+)\)$', name)
    if not team:
        raise RuntimeError('Signing identity has no recognizable Apple team identifier')
    return fingerprint, team.group(1)


def assess_gatekeeper(command, evidence):
    result = run(command, capture_output=True, text=True)
    text = result.stdout + result.stderr
    evidence.write_text(text)
    print(text, flush=True)
    if not re.search(r'\baccepted\b', text, re.IGNORECASE):
        raise RuntimeError('Gatekeeper did not explicitly accept the artifact')


def validate_mounted_app(app, team, evidence):
    run(['codesign', '--verify', '--deep', '--strict', '--verbose=2', app])
    details = subprocess.run(['codesign', '-dv', '--verbose=4', str(app)],
                             capture_output=True, text=True, check=True).stderr
    if f'TeamIdentifier={team}' not in details or 'Authority=Developer ID Application:' not in details:
        raise RuntimeError('Mounted application does not have the intended Developer ID signature')
    flags = re.search(r'flags=0x[0-9a-fA-F]+\(([^)]*)\)', details)
    if not flags or 'runtime' not in flags.group(1).split(','):
        raise RuntimeError('Mounted application does not enable the hardened runtime')
    entitlements = subprocess.run(['codesign', '-d', '--entitlements', ':-', str(app)],
                                  capture_output=True, check=True).stdout
    # Helpers can legitimately have no entitlements at all. Malformed,
    # nonempty output still fails parsing; empty output grants no entitlement.
    parsed_entitlements = plistlib.loads(entitlements) if entitlements.strip() else {}
    if parsed_entitlements.get('com.apple.security.get-task-allow', False):
        raise RuntimeError('Refusing a development-debuggable distribution signature')
    run(['xcrun', 'stapler', 'validate', app])
    assess_gatekeeper(['spctl', '--assess', '--type', 'execute', '--verbose=2', app], evidence)
    return details


def smoke_test(app, artifacts, node, updater_enabled=False):
    with socket.socket() as server:
        server.bind(('127.0.0.1', 0))
        port = server.getsockname()[1]
    scripts = Path(__file__).resolve().parent
    with tempfile.TemporaryDirectory(prefix='browser-operator-dmg-profile-') as profile:
        with (artifacts / 'browser.log').open('w') as log:
            process = subprocess.Popen([
                str(app / 'Contents/MacOS/Browser Operator'), '--headless=new',
                '--use-mock-keychain', '--user-data-dir=' + profile,
                '--no-first-run', '--no-default-browser-check', '--lang=en-US',
                '--remote-debugging-address=127.0.0.1', f'--remote-debugging-port={port}',
                'about:blank',
            ], stdout=log, stderr=subprocess.STDOUT)
            try:
                endpoint = f'http://127.0.0.1:{port}'
                deadline = time.monotonic() + 30
                while True:
                    if process.poll() is not None:
                        raise RuntimeError('Mounted DMG app exited during startup; inspect browser.log')
                    try:
                        with urllib.request.urlopen(endpoint + '/json/version', timeout=1):
                            break
                    except OSError:
                        if time.monotonic() >= deadline:
                            raise RuntimeError('Mounted DMG app did not expose its local test endpoint')
                        time.sleep(0.25)
                version = plistlib.loads((app / 'Contents/Info.plist').read_bytes())['CFBundleShortVersionString']
                run([node, scripts / 'verify_chromium_release.mjs', endpoint, version, artifacts])
                if not updater_enabled:
                    run([node, scripts / 'verify_chromium_about.mjs', endpoint, artifacts])
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()


def verify_release(source, output, app_name, version, team, settings, node, provenance=None):
    dmgs = list((output / 'artifacts').glob('*.dmg'))
    if len(dmgs) != 1:
        raise RuntimeError('Expected exactly one final DMG')
    dmg = dmgs[0]
    run(['codesign', '--verify', '--strict', '--verbose=2', dmg])
    run(['xcrun', 'stapler', 'validate', dmg])
    assess_gatekeeper(['spctl', '--assess', '--type', 'open', '--context',
                       'context:primary-signature', '--verbose=2', dmg], output / 'gatekeeper-dmg.txt')
    run(['hdiutil', 'verify', dmg])
    mounted = plistlib.loads(subprocess.check_output(
        ['hdiutil', 'attach', '-readonly', '-nobrowse', '-plist', str(dmg)]))
    volume = next(Path(entry['mount-point']) for entry in mounted['system-entities'] if 'mount-point' in entry)
    try:
        mounted_app = volume / app_name
        mounted_version = plistlib.loads((mounted_app / 'Contents/Info.plist').read_bytes())['CFBundleShortVersionString']
        if mounted_version != version:
            raise RuntimeError(f'Mounted app version {mounted_version} differs from expected {version}')
        if not (volume / 'Applications').is_symlink() or os.readlink(volume / 'Applications') != '/Applications':
            raise RuntimeError('DMG is missing the Applications installation shortcut')
        validate_mounted_app(mounted_app, team, output / 'gatekeeper-app.txt')
        architecture = subprocess.check_output(
            ['lipo', '-archs', str(mounted_app / 'Contents/MacOS/Browser Operator')], text=True).strip()
        if architecture != 'arm64':
            raise RuntimeError(f'Unexpected DMG architecture: {architecture}')
        tests = output / 'verification'
        tests.mkdir(exist_ok=True)
        updater_enabled = settings['enable_updater'] == 'true'
        if updater_enabled:
            helpers = mounted_app / 'Contents/Frameworks/Browser Operator Framework.framework/Versions/Current/Helpers'
            updater_apps = [p for p in helpers.glob('*Updater*.app') if p.is_dir()]
            if len(updater_apps) != 1:
                raise RuntimeError('Expected exactly one embedded updater')
            validate_mounted_app(updater_apps[0], team, output / 'gatekeeper-updater.txt')
        smoke_test(mounted_app, tests, node, updater_enabled=updater_enabled)
    finally:
        run(['hdiutil', 'detach', volume])
    with dmg.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if provenance is None:
        provenance = {'source_base_revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip(),
                      'source_has_local_changes': bool(subprocess.check_output(
                          ['git', 'status', '--porcelain', '--untracked-files=no'], cwd=source))}
    manifest = {'version': version, 'architecture': 'arm64', 'team_id': team,
                **{key: value for key, value in provenance.items() if key.startswith('source_')},
                'dmg': dmg.name, 'sha256': digest, 'build_settings': settings,
                'notarization': 'accepted and stapled', 'gatekeeper': 'accepted',
                'mounted_app_functional_tests': 'passed'}
    manifest['native_updater_upgrade_test'] = 'pending' if settings['enable_updater'] == 'true' else 'not enabled'
    updater_config = settings['browser_operator_updater_config'].strip('"')
    manifest['update_channel'] = ('cloud-test' if updater_config.endswith('/macos-cloud-test.generated.gni')
                                  else 'local-test' if updater_config.endswith('/macos-local-test.gni')
                                  else 'manual' if settings['enable_updater'] == 'false' else 'configured')
    if provenance and provenance.get('updater_composition'):
        manifest['updater_composition'] = provenance['updater_composition']
    (output / 'release-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest, indent=2), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chromium-src', required=True, type=Path)
    parser.add_argument('--build-dir', default='out/Release', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--identity', default=os.environ.get('SIGNING_IDENTITY'))
    parser.add_argument('--keychain-profile', default=os.environ.get('KEYCHAIN_PROFILE', 'tthoma9'))
    parser.add_argument('--node', default=shutil.which('node'))
    parser.add_argument('--updater-enabled', action='store_true',
                        help='Package and sign an updater-enabled build; upgrade qualification is a separate test')
    parser.add_argument('--frozen-input', type=Path,
                        help='Use hash-verified signing inputs captured from a completed native build')
    parser.add_argument('--verify-existing', action='store_true',
                        help='Resume final verification of an existing signed/stapled DMG without signing or uploading again')
    args = parser.parse_args()
    if sys.platform != 'darwin' or sys.version_info < (3, 11):
        parser.error('macOS and Python 3.11+ are required for the Chromium signing pipeline')
    if not args.node:
        parser.error('Node.js is required for final DMG functional tests')
    subprocess.Popen(['/usr/bin/caffeinate', '-i', '-w', str(os.getpid())])
    source = args.chromium_src.expanduser().resolve()
    build = args.frozen_input.expanduser().resolve() if args.frozen_input else (source / args.build_dir).resolve()
    output = args.output.expanduser().resolve()
    app = build / 'Browser Operator.app'
    if output.is_relative_to(app.resolve()):
        raise RuntimeError('Release output must not be inside the input application bundle')
    if args.verify_existing and (output / 'release-manifest.json').exists():
        raise RuntimeError('This release is already verified; its manifest will not be overwritten')
    if not args.verify_existing and output.exists() and any(output.iterdir()):
        raise RuntimeError('Output must be absent or empty; existing releases are never removed')
    if shutil.disk_usage(source).free < 5 * 1024**3:
        raise RuntimeError('At least 5 GiB free is required for signing and packaging')
    provenance = None
    if args.frozen_input:
        from updater.frozen_input import load
        provenance = load(build)
        settings = validate_shipping_settings(provenance['build_settings'], args.updater_enabled)
    else:
        settings = shipping_args(source, build, updater_enabled=args.updater_enabled)
        from updater.frozen_input import require_current_build
        require_current_build(source, build, ['chrome', 'chrome/installer/mac'])
    identity, team = find_identity(args.identity)
    packaging = build / 'Browser Operator Packaging'
    if not (packaging / 'sign_chrome.py').is_file():
        raise RuntimeError('Build chrome/installer/mac to generate the packaging pipeline first')
    version = plistlib.loads((app / 'Contents/Info.plist').read_bytes())['CFBundleShortVersionString']
    if provenance and provenance['version'] != version:
        raise RuntimeError('Frozen input version differs from its captured build metadata')
    if args.verify_existing:
        verify_release(source, output, app.name, version, team, settings, args.node, provenance)
        return
    # Read-only authentication preflight; no password or private key is logged.
    subprocess.run([
        'xcrun', 'notarytool', 'history', '--keychain-profile', args.keychain_profile,
        '--output-format', 'json'], stdout=subprocess.DEVNULL, check=True)
    output.mkdir(parents=True, exist_ok=True)
    (output / 'notary-preflight.json').write_text(
        json.dumps({'authentication': 'verified'}, indent=2) + '\n')
    # A pre-sign updater-enabled browser can try to register its unsigned
    # helper. Test that build only after all nested code is properly signed.
    if not args.updater_enabled:
        pre_sign_tests = output / 'pre-sign-verification'
        pre_sign_tests.mkdir()
        smoke_test(app, pre_sign_tests, args.node)
    artifacts = output / 'artifacts'
    artifacts.mkdir()
    with tempfile.TemporaryDirectory(prefix='signing-input-', dir=output) as temp:
        staging = Path(temp)
        # APFS copy-on-write clone preserves the input app and bounds disk use.
        run(['cp', '-cR', app, staging / app.name])
        if args.updater_enabled:
            from updater.sign_embedded_updater import sign_embedded_updater
            sign_embedded_updater(build, staging, staging / app.name, identity,
                                  args.keychain_profile, output / 'sign-updater.log')
        staged_packaging = staging / packaging.name
        shutil.copytree(packaging, staged_packaging)
        # Gatekeeper cannot approve a freshly signed app before Apple has
        # notarized it. Defer ONLY this pre-notary check; strict app and DMG
        # Gatekeeper checks below remain mandatory after stapling.
        config = staged_packaging / 'signing/internal_config.py'
        if config.exists():
            raise RuntimeError('Unexpected existing custom signing configuration')
        suffix = '-arm64'
        if settings['browser_operator_updater_config'].strip('"').endswith(('/macos-local-test.gni', '/macos-cloud-test.generated.gni')):
            suffix += '-updater-test'
        config.write_text(
            'from .chromium_config import ChromiumCodeSignConfig\n'
            'class InternalCodeSignConfig(ChromiumCodeSignConfig):\n'
            '    @property\n'
            '    def run_spctl_assess(self):\n'
            '        return False  # Enforced after notarization by the release runner.\n'
            '    @property\n'
            '    def packaging_basename(self):\n'
            f'        return super().packaging_basename + {suffix!r}\n')
        # Modern macOS's legacy HFS hybrid path can add FinderInfo to signed
        # executables. Use an APFS adapter and verify the mounted app before
        # the generated pipeline signs/notarizes the DMG.
        shutil.copyfile(Path(__file__).with_name('chromium_apfs_dmg.py'),
                        staged_packaging / 'signing/browser_operator_dmg.py')
        pipeline = staged_packaging / 'signing/pipeline.py'
        text = pipeline.read_text()
        old = '    commands.run_command(pkg_dmg)\n\n    return dmg_path'
        if text.count(old) != 1:
            raise RuntimeError('Unknown DMG pipeline revision; review the APFS packaging adapter')
        text = text.replace(old,
            '    from signing.browser_operator_dmg import package_dmg\n'
            '    package_dmg(paths, dist, config, dmg_path)\n\n    return dmg_path')
        pipeline.write_text(text)
        for attempt in range(1, 4):
            attempt_output = output / f'signing-attempt-{attempt}'
            log_path = output / ('sign-and-notarize.log' if attempt == 1 else f'sign-and-notarize-{attempt}.log')
            try:
                with log_path.open('w') as log:
                    run([sys.executable, staged_packaging / 'sign_chrome.py',
                         '--input', staging, '--output', attempt_output, '--identity', identity,
                         '--notarize', 'staple', '--notary-arg=--keychain-profile',
                         '--notary-arg=' + args.keychain_profile], stdout=log, stderr=subprocess.STDOUT)
                completed = list(attempt_output.glob('*.dmg'))
                if len(completed) != 1:
                    raise RuntimeError('Signing pipeline did not produce exactly one DMG')
                completed[0].rename(artifacts / completed[0].name)
                break
            except subprocess.CalledProcessError:
                # Preserve failed output/logs; retry only the known transient
                # Apple timestamp-service failure seen in the existing workflow.
                if attempt == 3 or 'A timestamp was expected but was not found' not in log_path.read_text():
                    raise
                print('Apple timestamp service failed transiently; retrying in 10 seconds', flush=True)
                time.sleep(10)
    verify_release(source, output, app.name, version, team, settings, args.node, provenance)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
