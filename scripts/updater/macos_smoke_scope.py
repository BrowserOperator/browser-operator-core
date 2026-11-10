"""Protect existing updater registrations and retire only a smoke test's helper."""

import json
from pathlib import Path
import plistlib
import subprocess


class UpdaterSmokeScope:
    def __init__(self, settings, team, evidence, home=None):
        self.home = home or Path.home()
        self.team, self.evidence = team, evidence
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
        if (self.controller.exists() or self.controller.is_symlink() or self.agents()
                or (Path('/Library') / self.relative).exists()):
            raise RuntimeError('Existing updater registration must be preserved; qualify releases with a clean dedicated macOS user')

    def __enter__(self):
        self.require_clean()
        return self

    def __exit__(self, *_exception):
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
