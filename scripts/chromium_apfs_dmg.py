"""APFS DMG adapter for Chromium's generated macOS signing pipeline.

Copied into the staged signing package by package_chromium_release.py. The
legacy pkg-dmg HFS hybrid path can add FinderInfo to signed Mach-O files on
modern macOS, invalidating their strict signatures after packaging.
"""

import os
from pathlib import Path
import plistlib
import subprocess
import tempfile


def package_dmg(paths, dist, config, dmg_path):
    if config.is_chrome_branded() or dist.inflation_kilobytes:
        raise RuntimeError('The APFS adapter supports the Browser Operator distribution only')
    with tempfile.TemporaryDirectory(prefix='apfs-dmg-root-', dir=paths.work) as temp:
        root = Path(temp)
        app = Path(paths.work) / config.app_dir
        subprocess.run(['cp', '-cR', str(app), str(root / config.app_dir)], check=True)
        os.symlink('/Applications', root / 'Applications')
        subprocess.run([
            'hdiutil', 'create', '-fs', 'APFS', '-format', 'ULMO',
            '-volname', config.app_product, '-srcfolder', str(root), dmg_path,
        ], check=True)
    # Catch packaging-induced signature changes before signing/submitting the
    # image. The release runner repeats this against the notarized final DMG.
    mounted = plistlib.loads(subprocess.check_output([
        'hdiutil', 'attach', '-readonly', '-nobrowse', '-plist', dmg_path,
    ]))
    volume = next(Path(entry['mount-point']) for entry in mounted['system-entities']
                  if 'mount-point' in entry)
    try:
        subprocess.run(['codesign', '--verify', '--deep', '--strict', '--verbose=2',
                        str(volume / config.app_dir)], check=True)
        shortcut = volume / 'Applications'
        if not shortcut.is_symlink() or os.readlink(shortcut) != '/Applications':
            raise RuntimeError('APFS DMG is missing its installation shortcut')
    finally:
        subprocess.run(['hdiutil', 'detach', str(volume)], check=True)
