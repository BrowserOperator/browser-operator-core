"""Ensure release smoke tests never replace an existing updater registration."""

from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from macos_smoke_scope import UpdaterSmokeScope


class ScopeTests(unittest.TestCase):
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
