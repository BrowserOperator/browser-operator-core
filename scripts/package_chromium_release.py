#!/usr/bin/env python3
"""Sign, notarize, package, and test a Chromium ARM64 or universal shipping DMG.

Uses Chromium's generated nested-signing pipeline and the existing project's
notarytool keychain profile. Never modifies the input app or deletes a release.
"""

import argparse
import contextlib
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


def validate_shipping_settings(values, updater_enabled=False, allow_universal=False):
    cpu = values.get('target_cpu')
    allowed = ('"arm64"', '"x64"', '"universal"') if allow_universal else ('"arm64"', '"x64"')
    if cpu not in allowed:
        raise RuntimeError('Shipping macOS build must target arm64 or x64')
    expected = {
        'is_official_build': 'true', 'is_debug': 'false',
        'is_component_build': 'false', 'dcheck_always_on': 'false',
        'chrome_pgo_phase': '2', 'devtools_bundle': 'true',
        'devtools_skip_typecheck': 'false', 'target_cpu': cpu,
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


def smoke_test(app, artifacts, node, updater_enabled=False, cpu=None, frontend_checks=True, product_version=None):
    with socket.socket() as server:
        server.bind(('127.0.0.1', 0))
        port = server.getsockname()[1]
    scripts = Path(__file__).resolve().parent
    with tempfile.TemporaryDirectory(prefix='browser-operator-dmg-profile-') as profile:
        with (artifacts / 'browser.log').open('w') as log:
            prefix = ['/usr/bin/arch', '-' + cpu] if cpu else []
            process = subprocess.Popen([*prefix,
                str(app / 'Contents/MacOS/Browser Operator'), '--headless=new',
                '--use-mock-keychain', '--user-data-dir=' + profile,
                '--no-first-run', '--no-default-browser-check', '--lang=en-US',
                '--remote-debugging-address=127.0.0.1', f'--remote-debugging-port={port}',
                'about:blank',
            ], stdout=log, stderr=subprocess.STDOUT)
            try:
                endpoint = f'http://127.0.0.1:{port}'
                # First-launch translation of the Intel framework can exceed
                # native startup time on Apple Silicon. Keep a bounded wait.
                deadline = time.monotonic() + (180 if cpu == 'x86_64' else 30)
                while True:
                    if process.poll() is not None:
                        raise RuntimeError('Release test app exited during startup; inspect browser.log')
                    try:
                        with urllib.request.urlopen(endpoint + '/json/version', timeout=1):
                            break
                    except OSError:
                        if time.monotonic() >= deadline:
                            raise RuntimeError('Release test app did not expose its local test endpoint')
                        time.sleep(0.25)
                version = plistlib.loads((app / 'Contents/Info.plist').read_bytes())['CFBundleShortVersionString']
                if frontend_checks:
                    run([node, scripts / 'verify_chromium_release.mjs', endpoint, version, artifacts,
                         *([product_version] if product_version else [])])
                if cpu and frontend_checks:
                    from chromium_macos_arch import process_architecture
                    report = json.loads((artifacts / 'report.json').read_text())
                    owned = [entry for entry in report['processInfo'] if entry['type'] in ('browser', 'renderer')]
                    if not any(p['type'] == 'browser' for p in owned) or not any(p['type'] == 'renderer' for p in owned):
                        raise RuntimeError('Expected live browser and renderer processes for architecture validation')
                    actual = [{**entry, 'architecture': process_architecture(entry['id'])} for entry in owned]
                    (artifacts / 'process-architectures.json').write_text(json.dumps(actual, indent=2) + '\n')
                    if any(p['architecture'] != cpu for p in actual):
                        raise RuntimeError('Browser or renderer helper ran the wrong architecture')
                if not updater_enabled:
                    run([node, scripts / 'verify_chromium_about.mjs', endpoint, artifacts])
                else:
                    run([node, scripts / 'updater/verify_browser_updater.mjs',
                         endpoint, version, 'successful-check', artifacts])
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()


def verify_release(source, output, app_name, version, team, settings, node, provenance=None, baseline_app=None):
    verification = output / 'verification'
    verification.mkdir(exist_ok=True)
    tests = Path(tempfile.mkdtemp(prefix='attempt-', dir=verification))
    dmgs = list((output / 'artifacts').glob('*.dmg'))
    if len(dmgs) != 1:
        raise RuntimeError('Expected exactly one final DMG')
    dmg = dmgs[0]
    run(['codesign', '--verify', '--strict', '--verbose=2', dmg])
    run(['xcrun', 'stapler', 'validate', dmg])
    assess_gatekeeper(['spctl', '--assess', '--type', 'open', '--context',
                       'context:primary-signature', '--verbose=2', dmg], tests / 'gatekeeper-dmg.txt')
    run(['hdiutil', 'verify', dmg])
    mounted = plistlib.loads(subprocess.check_output(
        ['hdiutil', 'attach', '-readonly', '-nobrowse', '-plist', str(dmg)]))
    volume = next(Path(entry['mount-point']) for entry in mounted['system-entities'] if 'mount-point' in entry)
    try:
        mounted_app = volume / app_name
        mounted_version = plistlib.loads((mounted_app / 'Contents/Info.plist').read_bytes())['CFBundleShortVersionString']
        if mounted_version != version:
            raise RuntimeError(f'Mounted app version {mounted_version} differs from expected {version}')
        from chromium_macos_arch import verify_bundle_version
        verify_bundle_version(mounted_app, version)
        if not (volume / 'Applications').is_symlink() or os.readlink(volume / 'Applications') != '/Applications':
            raise RuntimeError('DMG is missing the Applications installation shortcut')
        validate_mounted_app(mounted_app, team, tests / 'gatekeeper-app.txt')
        from chromium_macos_arch import verify_architectures
        architecture = settings['target_cpu'].strip('"')
        binaries = verify_architectures(mounted_app, architecture)
        updater_enabled = settings['enable_updater'] == 'true'
        if updater_enabled:
            helpers = mounted_app / 'Contents/Frameworks/Browser Operator Framework.framework/Versions/Current/Helpers'
            updater_apps = [p for p in helpers.glob('*Updater*.app') if p.is_dir()]
            if len(updater_apps) != 1:
                raise RuntimeError('Expected exactly one embedded updater')
            validate_mounted_app(updater_apps[0], team, tests / 'gatekeeper-updater.txt')
        tested_architectures = ['arm64', 'x86_64'] if architecture == 'universal' else ['arm64']
        from updater.macos_smoke_scope import UpdaterSmokeScope
        def restore_baseline():
            restore = tests / 'restore-installed-baseline'
            restore.mkdir()
            smoke_test(baseline_app, restore, node, updater_enabled=True, frontend_checks=False)
        scope = UpdaterSmokeScope(settings, team, tests, baseline_app=baseline_app,
                                 restore_baseline=restore_baseline) if updater_enabled else contextlib.nullcontext()
        # Native Chromium correctly refuses registration on a read-only DMG.
        # Exercise the actual installation path using this exact verified app,
        # leaving the user's /Applications and browser profile untouched.
        installed = tests / 'installed'
        installed.mkdir()
        installed_app = installed / app_name
        run(['cp', '-cR', mounted_app, installed_app])
        validate_mounted_app(installed_app, team, tests / 'gatekeeper-installed-app.txt')
        with scope:
            for cpu in tested_architectures:
                cpu_tests = tests / cpu
                cpu_tests.mkdir(exist_ok=True)
                smoke_test(installed_app, cpu_tests, node, updater_enabled=updater_enabled, cpu=cpu,
                           product_version=provenance.get('browser_operator_version') if provenance else None)
        # This is an owned disposable installation, not the mounted app or a
        # user's browser. Keep failed attempts for diagnosis; retire successes.
        shutil.rmtree(installed)
    finally:
        run(['hdiutil', 'detach', volume])
    with dmg.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if provenance is None:
        provenance = {'source_base_revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip(),
                      'source_has_local_changes': bool(subprocess.check_output(
                          ['git', 'status', '--porcelain', '--untracked-files=no'], cwd=source))}
        if settings['enable_updater'] == 'true':
            from chromium_build_input import updater_trust
            provenance['updater_trust'] = updater_trust(source, settings)
    manifest = {'version': version, 'architecture': architecture, 'team_id': team,
                **{key: value for key, value in provenance.items() if key.startswith('source_')},
                'dmg': dmg.name, 'sha256': digest, 'build_settings': settings,
                'notarization': 'accepted and stapled', 'gatekeeper': 'accepted',
                'mounted_app_validation': 'passed',
                'installed_dmg_copy_functional_tests': 'passed'}
    manifest['mach_o_architectures'] = binaries
    if provenance.get('browser_operator_version'):
        manifest['browser_operator_version'] = provenance['browser_operator_version']
    for key in ('publication_policy', 'release_source_trees'):
        if provenance.get(key):
            manifest[key] = provenance[key]
    manifest['verification_evidence'] = str(tests.relative_to(output))
    manifest['functional_test_architectures'] = {cpu: 'passed' for cpu in tested_architectures}
    if architecture == 'universal':
        manifest['intel_hardware_test'] = 'pending; x86_64 tested with Rosetta on Apple Silicon'
    if settings['enable_updater'] == 'true':
        if provenance and provenance.get('updater_trust'):
            manifest['updater_trust'] = provenance['updater_trust']
    for key in ('native_source_state', 'frontend_source_state'):
        if provenance.get(key):
            manifest[key] = provenance[key]
    manifest['native_updater_upgrade_test'] = 'pending' if settings['enable_updater'] == 'true' else 'not enabled'
    updater_config = settings['browser_operator_updater_config'].strip('"')
    manifest['update_channel'] = ('cloud-test' if updater_config.endswith('/macos-cloud-test.generated.gni')
                                  else 'local-test' if updater_config.endswith('/macos-local-test.gni')
                                  else 'manual' if settings['enable_updater'] == 'false'
                                  else 'stable' if updater_config.endswith('/macos-production.gni') else 'configured')
    if provenance and provenance.get('updater_composition'):
        manifest['updater_composition'] = provenance['updater_composition']
    if provenance and provenance.get('universal_composition'):
        manifest['universal_composition'] = {**provenance['universal_composition'],
            'intel_runtime_test': 'passed under Rosetta; physical Intel hardware qualification pending'}
    (output / 'release-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest, indent=2), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chromium-src', required=True, type=Path)
    parser.add_argument('--build-dir', default='out/Release', type=Path)
    parser.add_argument('--architecture', choices=('arm64', 'universal'), default='arm64')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--identity', default=os.environ.get('SIGNING_IDENTITY'))
    parser.add_argument('--keychain-profile', default=os.environ.get('KEYCHAIN_PROFILE', 'tthoma9'))
    parser.add_argument('--node', default=shutil.which('node'))
    updater = parser.add_mutually_exclusive_group()
    updater.add_argument('--updater-enabled', action='store_true', default=True,
                         help='Sign the embedded updater (default); upgrade qualification is a separate test')
    updater.add_argument('--manual-updates', dest='updater_enabled', action='store_false',
                         help='Explicitly package a historical/manual-update build')
    parser.add_argument('--frozen-input', type=Path,
                        help='Use hash-verified signing inputs captured from a completed native build')
    parser.add_argument('--installed-updater-baseline', type=Path,
                        help='Explicit same-version installed app to preserve and restore through its native updater API')
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
    output_volume = output
    while not output_volume.exists():
        output_volume = output_volume.parent
    if shutil.disk_usage(output_volume).free < 5 * 1024**3:
        raise RuntimeError('At least 5 GiB free is required on the release output volume')
    provenance = None
    if args.frozen_input:
        from chromium_build_input import load
        provenance = load(build)
        provenance['source_frozen_manifest_sha256'] = hashlib.sha256((build / 'frozen-input.json').read_bytes()).hexdigest()
        settings = validate_shipping_settings(provenance['build_settings'], args.updater_enabled,
                                               allow_universal=bool(provenance.get('universal_composition')))
    else:
        settings = shipping_args(source, build, updater_enabled=args.updater_enabled)
        from chromium_build_input import release_targets, require_current_build
        require_current_build(source, build, release_targets(settings))
    if settings['target_cpu'] != '"' + args.architecture + '"':
        raise RuntimeError('Requested DMG architecture differs from the verified build inputs')
    if args.architecture == 'universal':
        if subprocess.run(['/usr/bin/arch', '-x86_64', '/usr/bin/true'],
                          capture_output=True).returncode:
            raise RuntimeError('Rosetta or Intel runtime is required to test the universal DMG before release')
    if (provenance and settings['browser_operator_updater_config'].endswith('/macos-production.gni"')
            and not provenance.get('updater_trust')):
        raise RuntimeError('Production frozen input must include the compiled updater trust roots')
    from chromium_macos_arch import verify_architectures
    verify_architectures(app, args.architecture)
    identity, team = find_identity(args.identity)
    if args.installed_updater_baseline:
        args.installed_updater_baseline = args.installed_updater_baseline.resolve()
        baseline_version = plistlib.loads((args.installed_updater_baseline / 'Contents/Info.plist').read_bytes())['CFBundleShortVersionString']
        if baseline_version != plistlib.loads((app / 'Contents/Info.plist').read_bytes())['CFBundleShortVersionString']:
            raise RuntimeError('Baseline reuse requires exactly the same browser/updater version; use a dedicated clean user for version upgrades')
    if args.updater_enabled:
        from updater.macos_smoke_scope import UpdaterSmokeScope
        UpdaterSmokeScope(settings, team, output, baseline_app=args.installed_updater_baseline).require_clean()
    packaging = build / 'Browser Operator Packaging'
    if not (packaging / 'sign_chrome.py').is_file():
        raise RuntimeError('Build chrome/installer/mac to generate the packaging pipeline first')
    version = plistlib.loads((app / 'Contents/Info.plist').read_bytes())['CFBundleShortVersionString']
    if provenance and provenance['version'] != version:
        raise RuntimeError('Frozen input version differs from its captured build metadata')
    if args.verify_existing:
        verify_release(source, output, app.name, version, team, settings, args.node, provenance, args.installed_updater_baseline)
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
        suffix = '-' + args.architecture
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
    verify_release(source, output, app.name, version, team, settings, args.node, provenance, args.installed_updater_baseline)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
