"""Ensure release smoke tests never replace an existing updater registration."""

from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from macos_smoke_scope import UpdaterSmokeScope


class ScopeTests(unittest.TestCase):
    def test_existing_baseline_is_restored_even_when_qualification_fails(self):
        with tempfile.TemporaryDirectory() as temp:
            scope = self.scope(Path(temp))
            scope.baseline_app = Path('/Applications/Browser Operator.app')
            restored = []
            scope.restore_baseline = lambda: restored.append(True)
            baseline = {'application': str(scope.baseline_app), 'version': '158.0.8127.18', 'helper_sha256': 'a' * 64}
            with patch.object(scope, 'baseline_registration', return_value=baseline), \
                    patch('macos_smoke_scope.subprocess.run') as run:
                with self.assertRaisesRegex(RuntimeError, 'qualification failed'):
                    with scope:
                        raise RuntimeError('qualification failed')
            self.assertEqual(restored, [True])
            run.assert_not_called()  # No uninstall or preference editing.

    def test_changed_baseline_after_restore_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            scope = self.scope(Path(temp))
            scope.baseline_app = Path('/Applications/Browser Operator.app')
            scope.restore_baseline = lambda: None
            with patch('macos_smoke_scope.time.sleep'), patch.object(scope, 'baseline_registration', side_effect=[{'version': '158'}, {'version': '159'}, {'version': '159'}, {'version': '159'}]):
                with self.assertRaisesRegex(RuntimeError, 'not restored exactly'):
                    with scope:
                        pass

    def scope(self, root):
        evidence = root / 'evidence'
        evidence.mkdir()
        return UpdaterSmokeScope({'browser_operator_updater_config': '"//config/macos-production.gni"'},
                                 'UNITTEAM', evidence, home=root)

    def test_existing_controller_is_never_changed(self):
        with tempfile.TemporaryDirectory() as temp:
            scope = self.scope(Path(temp))
            scope.controller.mkdir(parents=True)
            marker = scope.controller / 'existing.txt'
            marker.write_text('preserve')
            with self.assertRaises(RuntimeError), patch('macos_smoke_scope.subprocess.run') as run:
                with scope:
                    self.fail('Entered an occupied namespace')
            run.assert_not_called()
            self.assertEqual(marker.read_text(), 'preserve')

    def test_only_new_matching_signed_helper_is_uninstalled(self):
        with tempfile.TemporaryDirectory() as temp:
            scope = self.scope(Path(temp))
            app = scope.controller / '158' / (scope.product + '.app')
            def run(command, **_kwargs):
                if '--uninstall' in command:
                    (scope.controller / 'Current').unlink()
                return subprocess.CompletedProcess(command, 0, stderr='TeamIdentifier=UNITTEAM\n')
            with patch('macos_smoke_scope.subprocess.run', side_effect=run) as calls:
                with scope:
                    (app / 'Contents').mkdir(parents=True)
                    (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': scope.appid}))
                    (scope.controller / 'Current').symlink_to('158')
            self.assertTrue(any('--uninstall' in call.args[0] for call in calls.call_args_list))
            self.assertFalse(scope.controller.exists())
            self.assertTrue((scope.evidence / 'native-updater-retired-controller').exists())

    def test_unexpected_new_helper_identity_is_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            scope = self.scope(Path(temp))
            with self.assertRaises(RuntimeError), patch('macos_smoke_scope.subprocess.run') as run:
                with scope:
                    app = scope.controller / '158' / (scope.product + '.app')
                    (app / 'Contents').mkdir(parents=True)
                    (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': 'different.app'}))
                    (scope.controller / 'Current').symlink_to('158')
            run.assert_not_called()
            self.assertTrue(scope.controller.exists())

    def test_restore_retries_and_preserves_warning_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            scope = self.scope(Path(temp))
            scope.baseline_app = Path('/Applications/Browser Operator.app')
            baseline = {'version': '158'}
            with patch.object(scope, 'baseline_registration', side_effect=[baseline, {'version': '159'}, baseline]), \
                    patch('macos_smoke_scope.time.sleep'), \
                    patch.object(scope, 'restore_baseline', side_effect=[RuntimeError('network unavailable'), None]) as restore:
                with scope:
                    pass
            self.assertEqual(restore.call_count, 2)
            self.assertIn('network unavailable', (scope.evidence / 'native-updater-baseline-restored.json').read_text())
