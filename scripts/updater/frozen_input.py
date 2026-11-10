"""Preserve a small verified signing input while reusing the native build tree."""

import hashlib
import json
from pathlib import Path
import subprocess


# Shared release validation is independent of the optional native updater.
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from chromium_build_input import inventory, load, require_current_build


def create(source, build, destination, settings, updater_product):
    if destination.exists():
        raise RuntimeError('Frozen input destination must not exist')
    require_current_build(source, build, [
        'chrome', 'chrome/installer/mac', 'chrome/updater/mac:updater_zip',
        'components/crx_file:crx3_build_action',
        'third_party/devtools-frontend/src/scripts/updater/native:browser_operator_update_verify',
    ])
    destination.mkdir(parents=True)
    names = ['Browser Operator.app', 'Browser Operator Packaging', 'Updater Packaging',
             updater_product + '.app', updater_product + 'Util',
             'crx3_build_action', 'browser_operator_update_verify']
    for name in names:
        subprocess.run(['cp', '-cR', str(build / name), str(destination / name)], check=True)
    import plistlib
    info = plistlib.loads((destination / 'Browser Operator.app/Contents/Info.plist').read_bytes())
    patch = subprocess.check_output(['git', 'diff', '--binary', 'HEAD'], cwd=source)
    metadata = {'schema': 1, 'version': info['CFBundleShortVersionString'],
        'source_base_revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip(),
        'source_has_local_changes': bool(patch), 'source_patch_sha256': hashlib.sha256(patch).hexdigest(),
        'build_settings': settings, 'input_files': inventory(destination)}
    (destination / 'frozen-input.json').write_text(json.dumps(metadata, indent=2) + '\n')
    load(destination)
    return metadata


if __name__ == '__main__':
    import argparse
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from package_chromium_release import shipping_args
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chromium-src', required=True, type=Path)
    parser.add_argument('--build-dir', default='out/Release', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    source = args.chromium_src.resolve()
    build = source / args.build_dir
    metadata = create(source, build, args.output.resolve(),
                      shipping_args(source, build, updater_enabled=True),
                      'BrowserOperatorUpdaterTest')
    print(f"Preserved {metadata['version']}: {len(metadata['input_files'])} verified inputs")
