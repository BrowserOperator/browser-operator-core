"""Preserve a small verified signing input while reusing the native build tree."""

import hashlib
import json
from pathlib import Path
import stat
import subprocess


def inventory(root):
    entries = {}
    for path in sorted(root.rglob('*')):
        name = path.relative_to(root).as_posix()
        if name == 'frozen-input.json':
            continue
        if path.is_symlink():
            entries[name] = {'link': str(path.readlink())}
        elif path.is_file():
            with path.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            entries[name] = {'sha256': digest, 'mode': stat.S_IMODE(path.stat().st_mode)}
    return entries


def load(root):
    metadata = json.loads((root / 'frozen-input.json').read_text())
    if metadata.get('schema') != 1 or metadata['input_files'] != inventory(root):
        raise RuntimeError('Frozen signing input is incomplete or has changed')
    return metadata


def require_current_build(source, build, targets):
    command = [
        str(source / 'third_party/ninja/ninja'), '-n', '-C', str(build),
        *targets,
    ]
    planned = subprocess.check_output(command, cwd=source, text=True)
    # `gn args --list` can rewrite generated gn_logs.txt, making only the
    # graph stale. Regenerate the graph, then still refuse actual build work.
    if 'Regenerating ninja files' in planned:
        # Let Ninja run its generator so the restat mtime in .ninja_log is
        # refreshed too; a direct `gn gen` does not refresh that record.
        subprocess.run([str(source / 'third_party/ninja/ninja'), '-C', str(build), 'build.ninja'],
                       cwd=source, check=True, stdout=subprocess.DEVNULL)
        planned = subprocess.check_output(command, cwd=source, text=True)
    if 'ninja: no work to do.' not in planned:
        raise RuntimeError('Build products must be current before signing or freezing input')


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
