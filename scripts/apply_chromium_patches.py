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


def combined_patch(chromium, patches):
    """Validate ordered, overlapping patches in a private partial source tree."""
    paths = set()
    for patch in patches:
        paths.update(re.findall(r'^(?:--- a/|\+\+\+ b/)(.+)$', patch.read_text(), re.M))
    if any(Path(name).is_absolute() or '..' in Path(name).parts for name in paths):
        raise RuntimeError('Unsafe reviewed patch path')
    with tempfile.TemporaryDirectory(prefix='browser-operator-patch-check-') as name:
        shadow = Path(name)
        subprocess.run(['git', 'init', '--quiet', str(shadow)], check=True)
        original = set()
        for relative in paths:
            source, target = chromium / relative, shadow / relative
            if source.is_symlink():
                raise RuntimeError('Refusing to patch a source symlink')
            if source.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
                original.add(relative)
        subprocess.run(['git', 'add', '--all'], cwd=shadow, check=True)
        for patch in patches:
            subprocess.run(['git', 'apply', '--check', str(patch)], cwd=shadow, check=True)
            subprocess.run(['git', 'apply', str(patch)], cwd=shadow, check=True)
        added = [relative for relative in paths - original if (shadow / relative).exists()]
        if added:
            subprocess.run(['git', 'add', '--intent-to-add', '--', *added], cwd=shadow, check=True)
        return subprocess.check_output(['git', 'diff', '--binary'], cwd=shadow)


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
    subprocess.run(['git', 'apply', '--check', '-'], cwd=chromium, input=prepared, check=True)
    asset_root = series / 'assets'
    assets = sorted(path for path in asset_root.rglob('*') if path.is_file())
    for asset in assets:
        destination = chromium / asset.relative_to(asset_root)
        if destination.exists() and destination.read_bytes() != asset.read_bytes():
            raise RuntimeError(f'Refusing to overwrite a different existing asset: {destination}')
    branding = []
    manifest_path = series / 'branding-assets.json'
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        vendor = args.branding_source.resolve() if args.branding_source else None
        if vendor:
            revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=vendor, text=True).strip()
            if revision != manifest['revision']:
                raise RuntimeError('Branding dependency revision differs from the reviewed manifest')
        for item in manifest['files']:
            relative, source_name = Path(item['destination']), Path(item['source'])
            if (relative.is_absolute() or source_name.is_absolute() or '..' in relative.parts
                    or '..' in source_name.parts or not str(relative).startswith('chrome/app/theme/')):
                raise RuntimeError('Invalid reviewed branding asset path')
            destination = chromium / relative
            source = vendor / source_name if vendor else destination
            if not source.is_file() or hashlib.sha256(source.read_bytes()).hexdigest() != item['sha256']:
                raise RuntimeError(f'Provide the pinned --branding-source for {relative}')
            branding.append((source, destination))
    print(f'Checked {len(patches)} feature patches and {len(assets)} assets for Chromium {version}', flush=True)
    if args.apply:
        # Git checks the entire series before writing any changes.
        subprocess.run(['git', 'apply', '-'], cwd=chromium, input=prepared, check=True)
        for asset in assets:
            destination = chromium / asset.relative_to(asset_root)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(asset, destination)
        for source, destination in branding:
            if source.resolve() != destination.resolve():
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, destination)
        print(f'Validated {len(branding)} pinned branding assets')
        print('Applied feature patches and toolbar assets. Branding and frontend integration are separate steps.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
