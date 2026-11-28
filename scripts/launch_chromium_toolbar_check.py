#!/usr/bin/env python3
"""Launch an exact signed DMG copy for the scripted Guest toolbar check."""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile

from chromium_build_input import load
from chromium_macos_arch import verify_architectures, verify_bundle_version, verify_update_channel
from package_chromium_release import smoke_test, validate_mounted_app
from updater.macos_smoke_scope import UpdaterSmokeScope


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', required=True, type=Path)
    parser.add_argument('--frozen-input', required=True, type=Path)
    parser.add_argument('--installed-updater-baseline', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    release, frozen = args.release.resolve(), args.frozen_input.resolve()
    baseline, output = args.installed_updater_baseline.resolve(), args.output.resolve()
    if output.exists():
        raise RuntimeError('Toolbar evidence output must be new')
    provenance = load(frozen)
    manifest_path = release / 'release-manifest.json'
    if not manifest_path.exists():
        manifest_path = release / 'candidate-manifest.json'
    manifest = json.loads(manifest_path.read_text())
    if (hashlib.sha256((frozen/'frozen-input.json').read_bytes()).hexdigest() != manifest['source_frozen_manifest_sha256'] or
            provenance['version'] != manifest['version'] or manifest['build_settings']['enable_updater'] != 'true'):
        raise RuntimeError('Toolbar candidate provenance/updater mismatch')
    baseline_info = plistlib.loads((baseline/'Contents/Info.plist').read_bytes())
    if baseline_info['CFBundleShortVersionString'] != manifest['version']:
        raise RuntimeError('Toolbar baseline must have the same browser version')
    dmg = release/'artifacts'/manifest['dmg']
    if dmg.parent != release/'artifacts':
        raise RuntimeError('Unexpected DMG filename')
    with dmg.open('rb') as stream:
        if hashlib.file_digest(stream,'sha256').hexdigest() != manifest['sha256']:
            raise RuntimeError('Toolbar candidate DMG changed')
    node = shutil.which('node')
    if not node:
        raise RuntimeError('Node is required for native baseline restoration')
    output.mkdir(parents=True)
    app = output/'installed/Browser Operator.app'
    app.parent.mkdir()
    mounted = plistlib.loads(subprocess.check_output(['hdiutil','attach','-readonly','-nobrowse','-plist',str(dmg)]))
    volume = next(Path(entry['mount-point']) for entry in mounted['system-entities'] if 'mount-point' in entry)
    try:
        subprocess.run(['cp','-cR',str(volume/app.name),str(app)],check=True)
    finally:
        subprocess.run(['hdiutil','detach',str(volume)],check=True)
    validate_mounted_app(app,manifest['team_id'],output/'gatekeeper-app.txt')
    verify_architectures(app,manifest['architecture'])
    verify_bundle_version(app,manifest['version'])
    verify_update_channel(app,manifest['build_settings'])

    def restore_baseline():
        evidence = Path(tempfile.mkdtemp(prefix='restore-baseline-',dir=output))
        smoke_test(baseline,evidence,node,updater_enabled=True,frontend_checks=False)

    with UpdaterSmokeScope(manifest['build_settings'],manifest['team_id'],output,
                           baseline_app=baseline,restore_baseline=restore_baseline):
        with (output/'browser.log').open('x') as log:
            child = subprocess.Popen([str(app/'Contents/MacOS/Browser Operator'),
                '--guest','--user-data-dir='+str(output/'profile'),'--use-mock-keychain',
                '--no-first-run','--no-default-browser-check','--lang=en-US','about:blank'],
                stdout=log,stderr=subprocess.STDOUT)
            try:
                ready = {'application':str(app),'pid':child.pid,'version':manifest['version'],
                    'architecture':manifest['architecture'],'product_version':provenance['browser_operator_version'],
                    'dmg_sha256':manifest['sha256'],'publication':'held-until-owner-merge'}
                (output/'ready.json').write_text(json.dumps(ready,indent=2)+'\n')
                print('Run verify_chromium_toolbar.cua.js for this app, then quit its Guest process:',flush=True)
                print(json.dumps(ready),flush=True)
                code = child.wait(timeout=1200)
                if code:
                    raise RuntimeError('Toolbar test browser exited with code '+str(code))
            finally:
                if child.poll() is None:
                    child.terminate()
                    try:
                        child.wait(timeout=20)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait(timeout=10)
    (output/'launcher-report.json').write_text(json.dumps({**ready,'startup_and_trust':'passed',
        'native_baseline_restoration':'passed','toolbar_actions':'recorded separately by CUA script'},indent=2)+'\n')


if __name__ == '__main__':
    main()
