"""Ensure release smoke tests never replace an existing updater registration."""

from pathlib import Path
import json
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


class RetiredCurrentLinkTests(unittest.TestCase):
    def test_owned_dangling_current_link_is_retired_before_evidence_export(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();evidence=root/'evidence';evidence.mkdir()
            settings={'browser_operator_updater_config':'"//config/updater/macos-production.gni"'}
            scope=UpdaterSmokeScope(settings,'TEAM',evidence,home=root/'home')
            scope.controller.mkdir(parents=True)
            (scope.controller/'Current').symlink_to('158.0.8127.37')
            with patch.object(scope,'agents',return_value=[]):scope.__exit__(None,None,None)
            self.assertFalse(any(p.is_symlink() for p in evidence.rglob('*')))
            self.assertTrue((evidence/'native-updater-retired-current.json').exists())
            self.assertTrue((evidence/'native-updater-retired-controller').is_dir())

    def test_outside_dangling_link_is_preserved_and_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory).resolve();evidence=root/'evidence';evidence.mkdir()
            settings={'browser_operator_updater_config':'"//config/updater/macos-production.gni"'}
            scope=UpdaterSmokeScope(settings,'TEAM',evidence,home=root/'home')
            scope.controller.mkdir(parents=True)
            (scope.controller/'Current').symlink_to(root/'outside')
            with patch.object(scope,'agents',return_value=[]):
                with self.assertRaisesRegex(RuntimeError,'escapes'):scope.__exit__(None,None,None)
            self.assertTrue((scope.controller/'Current').is_symlink())


class InstalledBaselineTests(unittest.TestCase):
    def fixture(self, root):
        evidence = root / 'evidence'
        evidence.mkdir()
        app = root / 'Applications/Browser Operator.app'
        (app / 'Contents').mkdir(parents=True)
        (app / 'Contents/Info.plist').write_bytes(plistlib.dumps({
            'CFBundleIdentifier':'com.browseroperator.BrowserOperator',
            'CFBundleShortVersionString':'159.0.8154.13'}))
        scope = UpdaterSmokeScope({'browser_operator_updater_config':'"//config/updater/macos-production.gni"'},
                                 'UNITTEAM', evidence, home=root, baseline_app=app, restore_baseline=lambda:None)
        helper = scope.controller / '158.0.8127.18/BrowserOperatorUpdater.app'
        (helper / 'Contents/MacOS').mkdir(parents=True)
        (helper / 'Contents/Info.plist').write_bytes(plistlib.dumps({
            'CFBundleIdentifier':scope.appid, 'CFBundleShortVersionString':'158.0.8127.18'}))
        binary = helper / 'Contents/MacOS/BrowserOperatorUpdater'
        binary.write_bytes(b'signed helper fixture')
        (scope.controller / 'Current').symlink_to('158.0.8127.18')
        prefs = scope.controller / 'prefs.json'
        prefs.write_text(json.dumps({'updateclientdata':{'apps':{'com.browseroperator.browseroperator':{
            'pv':'159.0.8154.13','ecp':str(app)}}}}))
        return scope, helper, binary, prefs

    def signed(self, command, **kwargs):
        return subprocess.CompletedProcess(command, 0, stderr='TeamIdentifier=UNITTEAM\n')

    def test_older_signed_helper_is_preserved_while_serving_newer_browser(self):
        with tempfile.TemporaryDirectory() as temp:
            scope, helper, binary, prefs = self.fixture(Path(temp).resolve())
            before = prefs.read_bytes()
            with patch('macos_smoke_scope.subprocess.run', side_effect=self.signed) as calls:
                with scope:
                    self.assertEqual('158.0.8127.18', scope.baseline['helper_version'])
                    self.assertEqual('159.0.8154.13', scope.baseline['version'])
            self.assertEqual(before, prefs.read_bytes())
            self.assertEqual(b'signed helper fixture', binary.read_bytes())
            self.assertEqual(Path('158.0.8127.18'), (scope.controller/'Current').readlink())
            self.assertFalse(any('--uninstall' in call.args[0] for call in calls.call_args_list))
            self.assertTrue((scope.evidence/'native-updater-baseline-restored.json').exists())

    def test_mismatched_browser_registration_refuses_before_test(self):
        for field, value in [('pv','158.0.8127.18'), ('ecp','/wrong/app')]:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temp:
                scope, _, _, prefs = self.fixture(Path(temp).resolve())
                data=json.loads(prefs.read_text());data['updateclientdata']['apps']['com.browseroperator.browseroperator'][field]=value
                prefs.write_text(json.dumps(data));before=prefs.read_bytes()
                with patch('macos_smoke_scope.subprocess.run',side_effect=self.signed):
                    with self.assertRaisesRegex(RuntimeError,'browser registration'):
                        with scope:self.fail('must not enter')
                self.assertEqual(before,prefs.read_bytes())

    def test_wrong_helper_identity_version_or_signing_team_is_rejected(self):
        for change, value, error in [('CFBundleIdentifier','other.updater','identity'),
                                     ('CFBundleShortVersionString','159.0.8154.13','directory'),
                                     ('CFBundleShortVersionString','4294967296.0.0.0','directory'),
                                     ('signing-team','OTHERTEAM','signing team')]:
            with self.subTest(change=change,value=value), tempfile.TemporaryDirectory() as temp:
                scope, helper, _, _ = self.fixture(Path(temp).resolve())
                info=helper/'Contents/Info.plist'
                data=plistlib.loads(info.read_bytes());data[change]=value;info.write_bytes(plistlib.dumps(data))
                def signed(command,**kwargs):
                    if change=='signing-team' and Path(command[-1]).resolve()==helper.resolve() and '-dv' in command:
                        return subprocess.CompletedProcess(command,0,stderr='TeamIdentifier=OTHERTEAM\n')
                    return self.signed(command,**kwargs)
                with patch('macos_smoke_scope.subprocess.run',side_effect=signed):
                    with self.assertRaisesRegex(RuntimeError,error):scope.require_clean()

    def test_helper_path_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();scope, helper, _, _=self.fixture(root)
            target=root/'other/BrowserOperatorUpdater.app';target.parent.mkdir();helper.rename(target)
            helper.symlink_to(target)
            with patch('macos_smoke_scope.subprocess.run',side_effect=self.signed):
                with self.assertRaisesRegex(RuntimeError,'path escapes'):scope.require_clean()

    def test_current_path_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();scope, _, _, _=self.fixture(root)
            current=scope.controller/'Current';current.unlink();current.symlink_to(root/'outside')
            with patch('macos_smoke_scope.subprocess.run',side_effect=self.signed):
                with self.assertRaisesRegex(RuntimeError,'within its own namespace'):scope.require_clean()

    def test_changed_helper_bytes_fail_exact_restoration_without_uninstall(self):
        with tempfile.TemporaryDirectory() as temp:
            scope, _, binary, prefs=self.fixture(Path(temp).resolve());before=prefs.read_bytes()
            with patch('macos_smoke_scope.subprocess.run',side_effect=self.signed) as calls, \
                    patch('macos_smoke_scope.time.sleep'):
                with self.assertRaisesRegex(RuntimeError,'not restored exactly'):
                    with scope:binary.write_bytes(b'changed helper')
            self.assertEqual(before,prefs.read_bytes())
            self.assertFalse(any('--uninstall' in call.args[0] for call in calls.call_args_list))
            self.assertTrue((scope.evidence/'native-updater-baseline-RESTORE-FAILED.json').exists())
