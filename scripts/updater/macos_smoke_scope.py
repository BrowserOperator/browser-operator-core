"""Protect existing updater registrations and retire only a smoke test's helper."""

import json
import hashlib
from pathlib import Path
import plistlib
import subprocess


class UpdaterSmokeScope:
    def __init__(self, settings, team, evidence, home=None, baseline_app=None, restore_baseline=None):
        self.home = home or Path.home()
        self.team, self.evidence = team, evidence
        self.baseline_app, self.restore_baseline = baseline_app, restore_baseline
        self.baseline = None
        config = settings['browser_operator_updater_config'].strip('"')
        if config.endswith('/macos-production.gni'):
            company, self.product, self.appid = 'BrowserOperator', 'BrowserOperatorUpdater', 'com.browseroperator.Updater'
        elif config.endswith(('/macos-local-test.gni', '/macos-cloud-test.generated.gni')):
            company, self.product, self.appid = 'BrowserOperatorUpdateTest', 'BrowserOperatorUpdaterTest', 'com.browseroperator.autoupdate-test.Updater'
        else:
            raise RuntimeError('Unknown updater namespace; use a dedicated qualification configuration')
        self.relative = Path('Application Support') / company / self.product
        self.controller = self.home / 'Library' / self.relative

    def agents(self):
        directory = self.home / 'Library/LaunchAgents'
        return [p for p in directory.glob('*.plist') if p.name.lower().startswith(self.appid.lower() + '.')]

    def require_clean(self):
        if self.baseline_app:
            self.baseline = self.baseline_registration()
            return
        if (self.controller.exists() or self.controller.is_symlink() or self.agents()
                or (Path('/Library') / self.relative).exists()):
            raise RuntimeError('Existing updater registration must be preserved; qualify releases with a clean dedicated macOS user')

    def __enter__(self):
        self.require_clean()
        if self.baseline_app and not self.restore_baseline:
            raise RuntimeError('An explicit baseline requires a native registration restore callback')
        return self

    def baseline_registration(self):
        if self.controller.is_symlink() or (Path('/Library') / self.relative).exists():
            raise RuntimeError('Baseline reuse requires an ordinary user controller without a system install')
        app = self.baseline_app.resolve()
        info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
        if info.get('CFBundleIdentifier') != 'com.browseroperator.BrowserOperator':
            raise RuntimeError('Unexpected installed baseline identity')
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
        details = subprocess.run(['codesign', '-dv', '--verbose=4', str(app)], capture_output=True, text=True, check=True).stderr
        if f'TeamIdentifier={self.team}' not in details:
            raise RuntimeError('Installed baseline is from another signing team')
        current = self.controller / 'Current'
        if not current.is_symlink() or not current.resolve().is_relative_to(self.controller.resolve()):
            raise RuntimeError('Expected an existing user updater within its own namespace')
        helper = current / (self.product + '.app')
        helper_info = plistlib.loads((helper / 'Contents/Info.plist').read_bytes())
        if helper_info.get('CFBundleIdentifier') != self.appid:
            raise RuntimeError('Unexpected baseline updater identity')
        subprocess.run(['codesign', '--verify', '--deep', '--strict', str(helper)], check=True)
        helper_details = subprocess.run(['codesign', '-dv', '--verbose=4', str(helper)], capture_output=True, text=True, check=True).stderr
        if f'TeamIdentifier={self.team}' not in helper_details:
            raise RuntimeError('Baseline updater is from another signing team')
        registration = json.loads((self.controller / 'prefs.json').read_text())['updateclientdata']['apps']['com.browseroperator.browseroperator']
        if (Path(registration['ecp']).resolve() != app or
                registration['pv'] != info['CFBundleShortVersionString'] or
                helper_info['CFBundleShortVersionString'] != info['CFBundleShortVersionString']):
            raise RuntimeError('Baseline app, updater and registration must have the same version and path')
        with (helper / 'Contents/MacOS' / self.product).open('rb') as stream:
            helper_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
        return {'application': str(app), 'version': registration['pv'], 'helper_sha256': helper_hash}

    def __exit__(self, *_exception):
        if self.baseline_app:
            # Restore through the installed browser's real native API. Never
            # edit live updater preferences or uninstall the permanent helper.
            self.restore_baseline()
            if self.baseline_registration() != self.baseline:
                raise RuntimeError('Installed updater baseline was not restored exactly')
            (self.evidence / 'native-updater-baseline-restored.json').write_text(
                json.dumps({**self.baseline, 'registration_restored': True, 'helper_uninstalled': False}) + '\n')
            return
        if not self.controller.exists() and not self.agents():
            return
        current = self.controller / 'Current'
        if current.exists():
            if not current.is_symlink() or not current.resolve().is_relative_to(self.controller.resolve()):
                raise RuntimeError('Smoke updater link escapes its newly created namespace')
            app = current / (self.product + '.app')
            info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
            if info['CFBundleIdentifier'] != self.appid:
                raise RuntimeError('Refusing to uninstall an unexpected updater identity')
            subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
            details = subprocess.run(['codesign', '-dv', '--verbose=4', str(app)],
                                     capture_output=True, text=True, check=True).stderr
            if f'TeamIdentifier={self.team}' not in details:
                raise RuntimeError('Refusing to uninstall an updater from another signing team')
            with (self.evidence / 'native-updater-uninstall.log').open('x') as log:
                subprocess.run([str(app / 'Contents/MacOS' / self.product), '--uninstall',
                                '--enable-logging', '--v=1'], check=True, timeout=120,
                               stdout=log, stderr=subprocess.STDOUT)
        if current.exists() or self.agents():
            raise RuntimeError('Smoke updater did not retire cleanly; preserve its diagnostics')
        # Chromium keeps its log after uninstall. Preserve all owned remnants in
        # the private verification evidence, leaving the next test a clean scope.
        if self.controller.exists():
            self.controller.rename(self.evidence / 'native-updater-retired-controller')
        (self.evidence / 'native-updater-cleanup.json').write_text(
            json.dumps({'created_by_test': True, 'uninstalled': True, 'existing_installations_touched': False}) + '\n')
