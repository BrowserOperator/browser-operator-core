#!/usr/bin/env python3
"""Combine an immutable baseline engine with a newer HTTPS test updater.

This preserves the real browser version and records both native build origins.
The app is unsigned staging input; the normal nested signing/notarization
pipeline must run after composition. No signed app is modified in place.
"""
import argparse
import hashlib
import json
from pathlib import Path
import plistlib
import shutil
import subprocess
from urllib.parse import urlsplit
from frozen_input import load, inventory

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--engine', type=Path, required=True)
p.add_argument('--updater', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
engine, updater = load(a.engine), load(a.updater)
config = updater['build_settings']['browser_operator_updater_config'].strip('"')
if not config.endswith('/macos-cloud-test.generated.gni'):
    p.error('Use an HTTPS cloud-test updater build')
info_path = Path('Browser Operator.app/Contents/Info.plist')
cloud_info = plistlib.loads((a.updater / info_path).read_bytes())
endpoint = cloud_info['KSUpdateURL']
url = urlsplit(endpoint)
if url.scheme != 'https' or url.path != '/service/update2/json':
    p.error('Unexpected cloud endpoint')
if a.output.exists():
    p.error('Output must not exist')
a.output.mkdir(parents=True)
for child in a.engine.iterdir():
    if child.name != 'frozen-input.json':
        subprocess.run(['cp', '-cR', str(child), str(a.output / child.name)], check=True)
for name in ['Updater Packaging', 'BrowserOperatorUpdaterTest.app', 'BrowserOperatorUpdaterTestUtil']:
    dest = a.output / name
    if dest.is_dir():
        shutil.rmtree(dest)
    elif dest.exists():
        dest.unlink()
    subprocess.run(['cp', '-cR', str(a.updater / name), str(dest)], check=True)
app_info = plistlib.loads((a.output / info_path).read_bytes())
app_info['KSUpdateURL'] = endpoint
(a.output / info_path).write_bytes(plistlib.dumps(app_info))
engine['build_settings']['browser_operator_updater_config'] = updater['build_settings']['browser_operator_updater_config']
engine['updater_composition'] = {
    'browser_engine_version': engine['version'],
    'updater_version': updater['version'],
    'updater_source_revision': updater['source_base_revision'],
    'updater_source_patch_sha256': updater['source_patch_sha256'],
    'updater_frozen_manifest_sha256': hashlib.sha256((a.updater / 'frozen-input.json').read_bytes()).hexdigest(),
    'endpoint': endpoint,
    'requires_signing_and_notarization': True,
}
engine['input_files'] = inventory(a.output)
(a.output / 'frozen-input.json').write_text(json.dumps(engine, indent=2) + '\n')
load(a.output)
print(json.dumps(engine['updater_composition'], indent=2))
