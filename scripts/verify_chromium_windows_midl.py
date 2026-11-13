#!/usr/bin/env python3
"""Check the patched MIDL provenance normalization without hiding ABI changes."""
import argparse
import importlib.util
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--chromium-src', required=True, type=Path)
args = parser.parse_args()
path = args.chromium_src / 'build/toolchain/win/midl.py'
spec = importlib.util.spec_from_file_location('reviewed_midl', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
original = '../../chrome/elevation_service/elevation_service_idl.idl'
generated = 'gen/chrome/elevation_service/elevation_service_idl.idl'
expected = b'/* Compiler settings for ' + original.encode() + b': */\r\nGUID A;\r\n'
actual = b'/* Compiler settings for ' + generated.encode() + b': */\r\nGUID A;\r\n'
assert module.NormalizeDynamicIdlComment(actual, original, generated) == expected
changed = actual.replace(b'GUID A', b'GUID B')
assert module.NormalizeDynamicIdlComment(changed, original, generated) != expected
assert module.NormalizeDynamicIdlComment(actual, original+'.template', generated) == actual
assert module.NormalizeDynamicIdlComment(b'GUID B;', original, generated) == b'GUID B;'
print('MIDL comment normalization passed; declaration/GUID differences remain visible')
