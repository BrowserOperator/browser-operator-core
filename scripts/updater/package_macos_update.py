#!/usr/bin/env python3
"""Wrap a verified macOS release as a pinned-key CRX3 local update candidate."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import stat
import subprocess
import tempfile
import zipfile


def archive_app(app, installer, destination):
    """Preserve executable modes and internal framework symlinks, without xattrs."""
    with zipfile.ZipFile(destination, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(installer, '.install')
        for path in [app, *sorted(app.rglob('*'))]:
            name = path.relative_to(app.parent).as_posix()
            if path.is_symlink():
                target = os.readlink(path)
                resolved = (path.parent / target).resolve()
                if Path(target).is_absolute() or not resolved.is_relative_to(app.resolve()) or not resolved.exists():
                    raise RuntimeError(f'External application symlink: {name}')
                entry = zipfile.ZipInfo(name)
                entry.create_system = 3
                entry.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(entry, target.encode())
            else:
                archive.write(path, name)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', required=True, type=Path)
    parser.add_argument('--build-input', required=True, type=Path)
    parser.add_argument('--crx-private-key', required=True, type=Path, help='PKCS#8 DER, kept outside the repository')
    parser.add_argument('--crx-public-key', required=True, type=Path, help='Public SPKI DER')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    release, build = args.release.resolve(), args.build_input.resolve()
    manifest = json.loads((release / 'release-manifest.json').read_text())
    if manifest.get('update_channel') not in ('local-test', 'cloud-test') or manifest['architecture'] != 'arm64':
        raise RuntimeError('This qualification tool only accepts isolated macOS ARM64 test releases')
    dmg = release / 'artifacts' / manifest['dmg']
    if dmg.parent != release / 'artifacts':
        raise RuntimeError('Invalid release filename')
    with dmg.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != manifest['sha256']:
            raise RuntimeError('DMG differs from the verified release manifest')
    if args.output.exists() or shutil.disk_usage(release).free < 5 * 1024**3:
        raise RuntimeError('Use a new output directory with at least 5 GiB free')
    installer = build / 'Browser Operator Packaging/updater/.install'
    version = manifest['version']
    script_version = re.search(r'^UPDATE_VERSION="([0-9.]+)"$', installer.read_text(), re.M)
    if not script_version or script_version.group(1) != version:
        raise RuntimeError('Installer script version does not match the verified app')
    # Validate the Apple tickets before creating an update candidate. A CRX
    # signature never substitutes for platform signing or notarization.
    subprocess.run(['codesign', '--verify', '--strict', str(dmg)], check=True)
    subprocess.run(['xcrun', 'stapler', 'validate', str(dmg)], check=True)
    mounted = plistlib.loads(subprocess.check_output([
        'hdiutil', 'attach', '-readonly', '-nobrowse', '-plist', str(dmg)]))
    volume = next(Path(e['mount-point']) for e in mounted['system-entities'] if 'mount-point' in e)
    args.output.mkdir(parents=True)
    try:
        app = volume / 'Browser Operator.app'
        info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
        if info['CFBundleShortVersionString'] != version or info['CFBundleIdentifier'] != 'com.browseroperator.BrowserOperator':
            raise RuntimeError('Mounted app identity/version mismatch')
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
        subprocess.run(['xcrun', 'stapler', 'validate', str(app)], check=True)
        subprocess.run(['spctl', '--assess', '--type', 'execute', str(app)], check=True)
        archive = args.output / f'BrowserOperator-{version}-arm64-update.zip'
        archive_app(app, installer, archive)
    finally:
        subprocess.run(['hdiutil', 'detach', str(volume)], check=True)
    # Exercise the same Chromium unzip implementation used by the updater.
    # Framework symlinks, executable modes and stapled app tickets must survive.
    with tempfile.TemporaryDirectory(prefix='archive-check-', dir=args.output) as temp:
        unpacked = Path(temp) / 'unpacked'
        subprocess.run([str(build / 'browser_operator_update_verify'), 'unzip',
                        str(archive), str(unpacked)], check=True)
        restored = unpacked / 'Browser Operator.app'
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(restored)], check=True)
        subprocess.run(['xcrun', 'stapler', 'validate', str(restored)], check=True)
        subprocess.run(['spctl', '--assess', '--type', 'execute', str(restored)], check=True)
        if not os.access(unpacked / '.install', os.X_OK):
            raise RuntimeError('Updater install script lost its executable mode')
    package = archive.with_suffix('.crx3')
    subprocess.run([str(build / 'crx3_build_action'), str(package), str(archive),
                    str(args.crx_private_key)], check=True)
    pin = hashlib.sha256(args.crx_public_key.read_bytes()).hexdigest()
    subprocess.run([str(build / 'browser_operator_update_verify'), 'crx', str(package), pin], check=True)
    with package.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    catalog = {'channel': 'autoupdate-test', 'apps': [{
        'appid': info['CFBundleIdentifier'], 'version': version,
        'crx': {'name': package.name, 'sha256': digest, 'size': package.stat().st_size},
    }]}
    (args.output / 'catalog-candidate.json').write_text(json.dumps(catalog, indent=2) + '\n')
    (args.output / 'update-manifest.json').write_text(json.dumps({
        'version': version, 'crx_sha256': digest, 'crx_public_key_sha256': pin,
        'source_release_sha256': manifest['sha256'],
        'source_base_revision': manifest['source_base_revision'],
        'native_upgrade_test': 'pending',
    }, indent=2) + '\n')
    print('Verified update candidate created; catalog has not been activated.')


if __name__ == '__main__':
    main()
