#!/usr/bin/env python3
"""Check or apply the Browser Operator feature patches for a Chromium version."""

import argparse
from pathlib import Path
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chromium-src', required=True, type=Path)
    parser.add_argument('--apply', action='store_true', help='Apply after checking; default only checks')
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
    command = ['git', 'apply', '--check'] + [str(patch) for patch in patches]
    subprocess.run(command, cwd=chromium, check=True)
    asset_root = series / 'assets'
    assets = sorted(path for path in asset_root.rglob('*') if path.is_file())
    for asset in assets:
        destination = chromium / asset.relative_to(asset_root)
        if destination.exists() and destination.read_bytes() != asset.read_bytes():
            raise RuntimeError(f'Refusing to overwrite a different existing asset: {destination}')
    print(f'Checked {len(patches)} feature patches and {len(assets)} assets for Chromium {version}', flush=True)
    if args.apply:
        # Git checks the entire series before writing any changes.
        subprocess.run(['git', 'apply'] + [str(patch) for patch in patches],
                       cwd=chromium, check=True)
        for asset in assets:
            destination = chromium / asset.relative_to(asset_root)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(asset, destination)
        print('Applied feature patches and toolbar assets. Branding and frontend integration are separate steps.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
