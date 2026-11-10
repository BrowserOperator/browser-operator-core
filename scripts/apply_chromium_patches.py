#!/usr/bin/env python3
"""Check or apply the Browser Operator feature patches for a Chromium version."""

import argparse
import hashlib
import json
import re
from pathlib import Path
import shutil
import subprocess
import tempfile

from chromium_git import git_environment


def combined_patch(chromium, patches):
    """Validate ordered, overlapping patches in a private partial source tree."""
    environment = git_environment()
    paths = set()
    for patch in patches:
        paths.update(re.findall(r'^(?:--- a/|\+\+\+ b/)(.+)$', patch.read_text(), re.M))
    if any(Path(name).is_absolute() or '..' in Path(name).parts for name in paths):
        raise RuntimeError('Unsafe reviewed patch path')
    with tempfile.TemporaryDirectory(prefix='browser-operator-patch-check-') as name:
        shadow = Path(name)
        subprocess.run(['git', 'init', '--quiet', str(shadow)], check=True, env=environment)
        original = set()
        for relative in paths:
            source, target = chromium / relative, shadow / relative
            if source.is_symlink() or not source.resolve().is_relative_to(chromium.resolve()):
                raise RuntimeError('Refusing to patch a source symlink')
            if source.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
                original.add(relative)
        subprocess.run(['git', 'add', '--all', '--force'], cwd=shadow, check=True, env=environment)
        for patch in patches:
            subprocess.run(['git', 'apply', '--whitespace=nowarn', '--check', str(patch)], cwd=shadow, check=True, env=environment)
            subprocess.run(['git', 'apply', '--whitespace=nowarn', str(patch)], cwd=shadow, check=True, env=environment)
        added = [relative for relative in paths - original if (shadow / relative).exists()]
        if added:
            subprocess.run(['git', 'add', '--force', '--intent-to-add', '--', *added], cwd=shadow, check=True, env=environment)
        return subprocess.check_output(['git', 'diff', '--no-ext-diff', '--no-color',
                                        '--src-prefix=a/', '--dst-prefix=b/', '--binary'],
                                       cwd=shadow, env=environment)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chromium-src', required=True, type=Path)
    parser.add_argument('--apply', action='store_true', help='Apply after checking; default only checks')
    parser.add_argument('--branding-source', type=Path,
                        help='Pinned BrowserOperator/build-script checkout supplying reviewed theme assets')
    args = parser.parse_args()
    chromium = args.chromium_src.expanduser().resolve()
    fields = dict(line.split('=', 1) for line in
                  (chromium / 'chrome/VERSION').read_text().splitlines() if '=' in line)
    version = '.'.join(fields[key] for key in ('MAJOR', 'MINOR', 'BUILD', 'PATCH'))
    root = Path(__file__).resolve().parents[1]
    series = root / 'patches/chromium' / version
    patches = sorted(series.glob('*.patch'))
    if not patches:
        raise SystemExit(f'No reviewed patch series for Chromium {version}: {series}')
    prepared = combined_patch(chromium, patches)
    subprocess.run(['git', 'apply', '--whitespace=nowarn', '--check', '-'], cwd=chromium, input=prepared, check=True, env=git_environment())
    asset_root = series / 'assets'
    assets = sorted(path for path in asset_root.rglob('*') if path.is_file())
    for asset in assets:
        destination = chromium / asset.relative_to(asset_root)
        if not destination.resolve().is_relative_to(chromium):
            raise RuntimeError('Asset destination escapes Chromium source')
        if destination.exists() and destination.read_bytes() != asset.read_bytes():
            raise RuntimeError(f'Refusing to overwrite a different existing asset: {destination}')
    branding = []
    manifest_path = series / 'branding-assets.json'
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        vendor = args.branding_source.resolve() if args.branding_source else None
        if vendor:
            revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=vendor, text=True, env=git_environment()).strip()
            if revision != manifest['revision']:
                raise RuntimeError('Branding dependency revision differs from the reviewed manifest')
        for item in manifest['files']:
            relative, source_name = Path(item['destination']), Path(item['source'])
            if (relative.is_absolute() or source_name.is_absolute() or '..' in relative.parts
                    or '..' in source_name.parts or not str(relative).startswith('chrome/app/theme/')):
                raise RuntimeError('Invalid reviewed branding asset path')
            destination = chromium / relative
            if not destination.resolve().is_relative_to(chromium):
                raise RuntimeError('Branding destination escapes Chromium source')
            source = vendor / source_name if vendor else destination
            if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest() != item['sha256']:
                raise RuntimeError(f'Provide the pinned --branding-source for {relative}')
            branding.append((source, destination))
    print(f'Checked {len(patches)} feature patches and {len(assets)} assets for Chromium {version}', flush=True)
    if args.apply:
        # Git checks the entire series before writing any changes.
        subprocess.run(['git', 'apply', '--whitespace=nowarn', '-'], cwd=chromium, input=prepared, check=True, env=git_environment())
        for asset in assets:
            destination = chromium / asset.relative_to(asset_root)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(asset, destination)
        for source, destination in branding:
            if source.resolve() != destination.resolve():
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, destination)
        print(f'Validated {len(branding)} pinned branding assets')
        print('Applied feature patches and toolbar assets. Pinned branding applied; frontend integration is a separate step.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
