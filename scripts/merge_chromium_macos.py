#!/usr/bin/env python3
"""Merge verified, matching ARM64/Intel browser and updater inputs before signing."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

from chromium_build_input import inventory, load
from chromium_macos_arch import MACHO_MAGICS, verify_architectures, verify_bundle_version


def merge(source, arm, intel, output):
    if output.exists():
        raise RuntimeError('Universal output must not exist')
    a, b = load(arm), load(intel)
    for key in ('version', 'browser_operator_version', 'source_base_revision', 'source_patch_sha256', 'updater_product',
                'native_source_state', 'frontend_source_state', 'updater_trust'):
        if a.get(key) != b.get(key) or not a.get(key):
            raise RuntimeError(f'Architecture inputs differ in {key}')
    if a['build_settings']['target_cpu'] != '"arm64"' or b['build_settings']['target_cpu'] != '"x64"':
        raise RuntimeError('Expected one ARM64 and one Intel input')
    for key in set(a['build_settings']) | set(b['build_settings']):
        if key != 'target_cpu' and a['build_settings'].get(key) != b['build_settings'].get(key):
            raise RuntimeError(f'Architecture build settings differ in {key}')
    product = a['updater_product']
    if not product or '/' in product:
        raise RuntimeError('Unsafe updater product')
    for directory in (arm, intel):
        verify_bundle_version(directory / 'Browser Operator.app', a['version'])
    output.mkdir(parents=True)
    universalizer = source / 'chrome/installer/mac/universalizer.py'
    reports = {}
    for name in ('Browser Operator.app', product + '.app', product + 'Util'):
        if name.endswith('.app'):
            verify_architectures(arm / name, 'arm64')
            verify_architectures(intel / name, 'x64')
        subprocess.run([sys.executable, str(universalizer), str(arm / name), str(intel / name),
                        str(output / name)], check=True)
        if name.endswith('.app'):
            reports[name] = verify_architectures(output / name, 'universal')
        else:
            arches = subprocess.check_output(['lipo', '-archs', str(output / name)], text=True).split()
            if set(arches) != {'arm64', 'x86_64'}:
                raise RuntimeError('Standalone updater utility is not universal')
    # Generated signing scripts/resources must match byte for byte across slices.
    signing_host_tools = []
    for name in ('Browser Operator Packaging', 'Updater Packaging'):
        arm_files, intel_files = inventory(arm / name), inventory(intel / name)
        for path in sorted(set(arm_files) | set(intel_files)):
            if arm_files.get(path) == intel_files.get(path):
                continue
            # These generated tools execute on the ARM signing Mac and never
            # ship inside the browser. All other signing resources must match.
            if name != 'Browser Operator Packaging' or path not in ('dmg_tool', 'hfs_tool'):
                raise RuntimeError(f'Architecture-independent packaging differs: {name}/{path}')
            for directory, expected in ((arm, 'arm64'), (intel, 'x86_64')):
                tool = directory / name / path
                if tool.is_symlink() or not tool.is_file():
                    raise RuntimeError('Expected regular signing host tool')
                with tool.open('rb') as stream:
                    if stream.read(4) not in MACHO_MAGICS:
                        raise RuntimeError('Expected Mach-O signing host tool')
                if subprocess.check_output(['lipo', '-archs', str(tool)], text=True).split() != [expected]:
                    raise RuntimeError('Unexpected signing host tool architecture')
            signing_host_tools.append({'path': f'{name}/{path}', 'retained_architecture': 'arm64'})
        subprocess.run(['cp', '-cR', str(arm / name), str(output / name)], check=True)
    # These tools run on the signing Mac, not inside the distributed app.
    for name in ('crx3_build_action', 'browser_operator_update_verify'):
        subprocess.run(['cp', '-c', str(arm / name), str(output / name)], check=True)
    metadata = {key: value for key, value in a.items() if key != 'input_files'}
    metadata['build_settings'] = {**a['build_settings'], 'target_cpu': '"universal"'}
    metadata['universal_composition'] = {
        'arm64_manifest_sha256': hashlib.sha256((arm / 'frozen-input.json').read_bytes()).hexdigest(),
        'x64_manifest_sha256': hashlib.sha256((intel / 'frozen-input.json').read_bytes()).hexdigest(),
        'all_bundled_mach_o_slices': reports,
        'signing_host_tools': signing_host_tools,
        'intel_runtime_test': 'pending; cross-compilation is not Intel runtime qualification',
    }
    metadata['mach_o_architectures'] = reports['Browser Operator.app']
    metadata['input_files'] = inventory(output)
    (output / 'frozen-input.json').write_text(json.dumps(metadata, indent=2) + '\n')
    load(output)
    return metadata


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chromium-src', required=True, type=Path)
    parser.add_argument('--arm64', required=True, type=Path)
    parser.add_argument('--x64', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    metadata = merge(args.chromium_src.resolve(), args.arm64.resolve(), args.x64.resolve(), args.output.resolve())
    print(f"Universal {metadata['version']} browser and updater inputs verified; signing is still required")
