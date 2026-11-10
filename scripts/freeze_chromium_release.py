#!/usr/bin/env python3
"""Freeze completed browser and updater signing inputs before reusing build output."""

import argparse
import ast
import hashlib
import json
from pathlib import Path
import plistlib
import re
import subprocess

from chromium_git import git_environment
from chromium_build_input import inventory, load, release_targets, require_current_build, source_state, updater_trust
from chromium_macos_arch import verify_architectures, verify_bundle_version
from package_chromium_release import shipping_args


def clean_frontend(state):
    return (state['patch_sha256'] == hashlib.sha256(b'').hexdigest()
            and not state['untracked_source_files']
            and state.get('gitlink_revision', state['revision']) == state['revision']
            and all(clean_frontend(child) for child in state['dependency_source_states'].values()))


def updater_product(build):
    tree = ast.parse((build / 'Updater Packaging/signing/build_props_config.py').read_text())
    products = [node.value.value for method in ast.walk(tree)
                if isinstance(method, ast.FunctionDef) and method.name == 'app_product'
                for node in method.body if isinstance(node, ast.Return)
                and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str)]
    if len(products) != 1 or '/' in products[0] or not products[0]:
        raise RuntimeError('Unknown generated updater product')
    return products[0]


def freeze(source, build, destination):
    if destination.exists():
        raise RuntimeError('Frozen input destination must not exist')
    settings = shipping_args(source, build, updater_enabled=True)
    cpu = settings['target_cpu'].strip('"')
    crypto = 'crx3_build_action' if cpu == 'arm64' else 'clang_arm64/crx3_build_action'
    require_current_build(source, build, release_targets(settings))
    product = updater_product(build)
    fields = dict(line.split('=', 1) for line in (source / 'chrome/VERSION').read_text().splitlines())
    version = '.'.join(fields[key] for key in ('MAJOR', 'MINOR', 'BUILD', 'PATCH'))
    verify_bundle_version(build / 'Browser Operator.app', version)
    binaries = verify_architectures(build / 'Browser Operator.app', cpu)
    verify_architectures(build / (product + '.app'), cpu)
    destination.mkdir(parents=True)
    for name in ['Browser Operator.app', 'Browser Operator Packaging', 'Updater Packaging',
                 product + '.app', product + 'Util', 'browser_operator_update_verify']:
        subprocess.run(['cp', '-cR', str(build / name), str(destination / name)], check=True)
    subprocess.run(['cp', '-c', str(build / crypto), str(destination / 'crx3_build_action')], check=True)
    info = plistlib.loads((destination / 'Browser Operator.app/Contents/Info.plist').read_bytes())
    frontend_root = (source / 'third_party/devtools-frontend/src').resolve()
    product_version = re.search(r"version: ['\"]([0-9]+\.[0-9]+\.[0-9]+)['\"]", (frontend_root / 'front_end/panels/ai_chat/core/Version.ts').read_text())
    if not product_version:
        raise RuntimeError('Expected an explicit Browser Operator product version')
    patch = subprocess.check_output(['git', 'diff', '--binary', '--no-ext-diff', '--no-textconv', 'HEAD'], cwd=source, env=git_environment())
    metadata = {
        'schema': 1, 'version': info['CFBundleShortVersionString'],
        'browser_operator_version': product_version.group(1),
        'source_base_revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True, env=git_environment()).strip(),
        'source_has_local_changes': bool(patch), 'source_patch_sha256': hashlib.sha256(patch).hexdigest(),
        'build_settings': settings, 'updater_product': product, 'mach_o_architectures': binaries,
        'native_source_state': source_state(source),
        'frontend_source_state': source_state(frontend_root),
        'updater_trust': updater_trust(source, settings),
        'input_files': inventory(destination),
    }
    policy_path = frontend_root / 'config/releases' / (product_version.group(1) + '.json')
    if tuple(map(int, product_version.group(1).split('.'))) >= (0, 7, 0) and not policy_path.exists():
        raise RuntimeError('Release policy required for product0.7.0 and later')
    if policy_path.exists():
        frontend_state = metadata['frontend_source_state']
        if not clean_frontend(frontend_state):
            raise RuntimeError('Merge-gated release inputs require committed, clean frontend source')
        metadata['publication_policy'] = json.loads(policy_path.read_text())
        metadata['release_source_trees'] = {'root': subprocess.check_output(
            ['git', 'rev-parse', 'HEAD^{tree}'], cwd=frontend_root, text=True, env=git_environment()).strip()}
    (destination / 'frozen-input.json').write_text(json.dumps(metadata, indent=2) + '\n')
    load(destination)
    return metadata


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chromium-src', required=True, type=Path)
    parser.add_argument('--build-dir', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    metadata = freeze(args.chromium_src.resolve(), args.chromium_src.resolve() / args.build_dir,
                      args.output.resolve())
    print(f"Preserved {metadata['version']} {metadata['build_settings']['target_cpu']} signing inputs")
