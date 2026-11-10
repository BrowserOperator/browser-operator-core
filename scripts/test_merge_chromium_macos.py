"""Exercise actual Mach-O merging and fail-closed architecture/resource checks."""

import json
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest

from chromium_build_input import inventory, load
from chromium_macos_arch import process_architecture, verify_architectures, verify_bundle_version
from merge_chromium_macos import merge


SOURCE = Path(os.environ.get('CHROMIUM_SRC_DIR', Path.home() / 'chromium/src'))


@unittest.skipUnless((SOURCE / 'chrome/installer/mac/universalizer.py').exists(), 'Chromium source required')
class UniversalMergeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='bo-universal-fixtures-')
        cls.root = Path(cls.temp.name)
        for arch in ('arm64', 'x86_64'):
            subprocess.run(['xcrun', 'clang', '-arch', arch, '-c', '-x', 'c', '-',
                            '-o', str(cls.root / (arch + '.o'))], input=b'int value(void) { return 1; }',
                           check=True)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def inputs(self, root):
        results = []
        for cpu, arch in [('arm64', 'arm64'), ('x64', 'x86_64')]:
            directory = root / cpu
            directory.mkdir()
            binary = (self.root / (arch + '.o')).read_bytes()
            for name in ('Browser Operator.app', 'BrowserOperatorUpdater.app'):
                app = directory / name
                (app / 'Contents/MacOS').mkdir(parents=True)
                (app / 'Contents/MacOS/executable').write_bytes(binary)
                (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({
                    'CFBundleShortVersionString': '158.0.8127.18',
                    'CFBundleIdentifier': 'com.browseroperator.BrowserOperator'}))
                if name == 'Browser Operator.app':
                    versions = app / 'Contents/Frameworks/Browser Operator Framework.framework/Versions'
                    (versions / '158.0.8127.18').mkdir(parents=True)
                    (versions / 'Current').symlink_to('158.0.8127.18', target_is_directory=True)
                (app / ('snapshot.' + arch + '.bin')).write_bytes(arch.encode())
                (app / 'shared.txt').write_text('identical resources')
            for name in ('Browser Operator Packaging', 'Updater Packaging'):
                (directory / name).mkdir()
                (directory / name / 'sign.py').write_text('# identical signing resources\n')
            for name in ('dmg_tool', 'hfs_tool'):
                (directory / 'Browser Operator Packaging' / name).write_bytes(binary)
            for name in ('BrowserOperatorUpdaterUtil', 'crx3_build_action', 'browser_operator_update_verify'):
                (directory / name).write_bytes(binary)
            metadata = {'schema': 1, 'version': '158.0.8127.18', 'browser_operator_version': '0.7.0', 'source_base_revision': 'a' * 40,
                        'source_patch_sha256': 'b' * 64, 'updater_product': 'BrowserOperatorUpdater',
                        'native_source_state': {'revision': 'a' * 40},
                        'frontend_source_state': {'revision': 'd' * 40, 'untracked_source_files': {}},
                        'updater_trust': {'config_sha256': 'e' * 64},
                        'build_settings': {'target_cpu': '"' + cpu + '"', 'enable_updater': 'true'},
                        'input_files': inventory(directory)}
            (directory / 'frozen-input.json').write_text(json.dumps(metadata))
            results.append(directory)
        return results

    def test_all_browser_and_updater_binaries_are_universal(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            arm, intel = self.inputs(root)
            output = root / 'universal'
            merge(SOURCE, arm, intel, output)
            self.assertEqual(load(output)['build_settings']['target_cpu'], '"universal"')
            self.assertEqual(len(load(output)['universal_composition']['signing_host_tools']), 2)
            for name in ('Browser Operator.app', 'BrowserOperatorUpdater.app'):
                self.assertEqual(len(verify_architectures(output / name, 'universal')), 1)
                self.assertTrue((output / name / 'snapshot.arm64.bin').exists())
                self.assertTrue((output / name / 'snapshot.x86_64.bin').exists())
            with self.assertRaises(RuntimeError):
                verify_architectures(arm / 'Browser Operator.app', 'universal')

    def test_changed_input_inventory_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            arm, intel = self.inputs(root)
            (intel / 'Browser Operator.app/shared.txt').write_text('changed after freezing')
            with self.assertRaises(RuntimeError):
                merge(SOURCE, arm, intel, root / 'universal')

    def test_stale_framework_version_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            arm, _ = self.inputs(Path(temp))
            app = arm / 'Browser Operator.app'
            versions = app / 'Contents/Frameworks/Browser Operator Framework.framework/Versions'
            (versions / '159.0.8144.0').mkdir()
            with self.assertRaises(RuntimeError):
                verify_bundle_version(app, '158.0.8127.18')

    def test_actual_runtime_cpu_is_observed_for_both_architectures(self):
        for cpu in ('arm64', 'x86_64'):
            with self.subTest(cpu=cpu):
                process = subprocess.Popen(['/usr/bin/arch', '-' + cpu, '/bin/sleep', '30'])
                try:
                    # arch sets the execution preference and execs the program.
                    import time
                    time.sleep(0.1)
                    self.assertEqual(process_architecture(process.pid), cpu)
                finally:
                    process.terminate()
                    process.wait()

    def test_mismatched_source_revision_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            arm, intel = self.inputs(root)
            manifest = intel / 'frozen-input.json'
            data = json.loads(manifest.read_text())
            data['source_base_revision'] = 'c' * 40
            manifest.write_text(json.dumps(data))
            with self.assertRaises(RuntimeError):
                merge(SOURCE, arm, intel, root / 'universal')

    def test_conflicting_non_code_resource_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            arm, intel = self.inputs(root)
            (intel / 'Browser Operator.app/shared.txt').write_text('incompatible resource')
            manifest = intel / 'frozen-input.json'
            data = json.loads(manifest.read_text())
            data['input_files'] = inventory(intel)
            manifest.write_text(json.dumps(data))
            with self.assertRaises(subprocess.CalledProcessError):
                merge(SOURCE, arm, intel, root / 'universal')

    def test_different_frontend_or_trust_roots_are_rejected(self):
        for key in ('frontend_source_state', 'native_source_state', 'updater_trust'):
            with self.subTest(key=key), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                arm, intel = self.inputs(root)
                manifest = intel / 'frozen-input.json'
                data = json.loads(manifest.read_text())
                data[key]['unexpected_change'] = True
                manifest.write_text(json.dumps(data))
                with self.assertRaises(RuntimeError):
                    merge(SOURCE, arm, intel, root / 'universal')


if __name__ == '__main__':
    unittest.main()
