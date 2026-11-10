"""Check production publishing preflight and immutable GitHub asset handling."""

import contextlib
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import subprocess
import unittest
from unittest.mock import patch

import publish_test_update as publisher


class ProductionPublishingTests(unittest.TestCase):
    def test_public_manifest_contains_no_local_paths_or_untracked_names(self):
        private = {'version': '158.0.8127.18', 'native_source_state': {
            'untracked_source_files': {'private-local-filename': {'link': '/Users/example/local'}}}}
        public = publisher.public_release_manifest(private)
        self.assertEqual(public['version'], private['version'])
        self.assertIn('native_source_state_sha256', public)
        self.assertNotIn('private-local-filename', json.dumps(public))
        self.assertNotIn('/Users/', json.dumps(public))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.release = self.root / 'release'
        self.candidate = self.root / 'candidate'
        (self.release / 'artifacts').mkdir(parents=True)
        self.candidate.mkdir()
        self.build = self.root / 'frozen'
        self.build.mkdir()
        (self.build / 'frozen-input.json').write_text('unit frozen metadata')
        self.tag = 'macos-159.0.8144.0-universal'
        self.dmg = self.release / 'artifacts/BrowserOperator-159.0.8144.0-universal.dmg'
        self.dmg.write_bytes(b'unit fixture; never uploaded')
        self.crx = self.candidate / 'BrowserOperator-159.0.8144.0-universal-update.crx3'
        self.crx.write_bytes(b'unit fixture; never uploaded')
        digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
        self.release_data = {'version': '159.0.8144.0', 'architecture': 'universal', 'update_channel': 'stable',
            'notarization': 'accepted and stapled', 'gatekeeper': 'accepted', 'dmg': self.dmg.name,
            'sha256': digest(self.dmg), 'updater_trust': {'crx_public_spki_sha256': 'a' * 64},
            'source_frozen_manifest_sha256': digest(self.build / 'frozen-input.json')}
        self.candidate_data = {'version': '159.0.8144.0', 'source_release_sha256': digest(self.dmg),
            'crx_sha256': digest(self.crx), 'crx_public_key_sha256': 'a' * 64,
            'channel': 'stable', 'architecture': 'universal'}
        self.catalog = {'channel': 'stable', 'apps': [{'appid': 'com.browseroperator.BrowserOperator',
            'version': '159.0.8144.0', 'architectures': ['arm64', 'x86_64'],
            'crx': {'name': self.crx.name, 'sha256': digest(self.crx), 'size': self.crx.stat().st_size}}]}

    def run_publish(self, checked, invalid_signature=False):
        for path, value in [(self.release / 'release-manifest.json', self.release_data),
                            (self.candidate / 'update-manifest.json', self.candidate_data),
                            (self.candidate / 'catalog-candidate.json', self.catalog)]:
            path.write_text(json.dumps(value))
        argv = ['publish', '--release', str(self.release), '--candidate', str(self.candidate), '--tag', self.tag,
                '--build-input', str(self.build)]
        frozen = {'version': self.release_data['version'], 'updater_trust': self.release_data['updater_trust'],
                  'build_settings': {'target_cpu': '"universal"'}}
        real_run = subprocess.run
        def run(command, **kwargs):
            if command[0].endswith('browser_operator_update_verify'):
                if invalid_signature:
                    raise subprocess.CalledProcessError(1, command)
                return subprocess.CompletedProcess(command, 0)
            return real_run(command, **kwargs)
        with patch.object(sys, 'argv', argv), patch.object(publisher, 'checked', checked), \
                patch('chromium_build_input.load', return_value=frozen), \
                patch.object(publisher.subprocess, 'run', run), \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            publisher.main(production=True)

    def test_wrong_publisher_pin_rejected_before_github(self):
        self.candidate_data['crx_public_key_sha256'] = 'b' * 64
        calls = []
        with self.assertRaises(SystemExit):
            self.run_publish(lambda *args: calls.append(args))
        self.assertEqual(calls, [])

    def test_invalid_native_crx_signature_prevents_github_access(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_publish(lambda *args: self.fail('Invalid signature reached GitHub'), invalid_signature=True)

    def test_changed_frozen_manifest_prevents_github_access(self):
        (self.build / 'frozen-input.json').write_text('different frozen inputs')
        with self.assertRaises(SystemExit):
            self.run_publish(lambda *args: self.fail('Changed input reached GitHub'))

    def test_duplicate_release_tags_are_rejected(self):
        item = {'tag_name': self.tag, 'draft': True, 'prerelease': False, 'id': 42}
        with self.assertRaises(SystemExit):
            self.run_publish(lambda *args: json.dumps([[item, dict(item, id=43)]]))

    def test_wrong_architecture_rejected_before_github(self):
        self.catalog['apps'][0]['architectures'] = ['arm64']
        with self.assertRaises(SystemExit):
            self.run_publish(lambda *args: self.fail('GitHub contacted before validation'))

    def test_changed_dmg_rejected_before_github(self):
        self.dmg.write_bytes(b'changed after release validation')
        with self.assertRaises(SystemExit):
            self.run_publish(lambda *args: self.fail('GitHub contacted before validation'))

    def test_existing_published_release_is_never_overwritten(self):
        calls = []
        def checked(*args):
            calls.append(args)
            return json.dumps([[{'tag_name': self.tag, 'draft': False, 'prerelease': False, 'id': 42}]])
        with self.assertRaises(SystemExit):
            self.run_publish(checked)
        self.assertTrue(all(args[0] == 'api' for args in calls))

    def test_verified_production_assets_published_after_remote_hash_confirmation(self):
        remote, calls = [], []
        created = False
        def checked(*args):
            nonlocal created
            calls.append(args)
            if args[0] == 'api' and 'releases?' in args[1]:
                return json.dumps([[{'tag_name': self.tag, 'draft': True, 'prerelease': False, 'id': 42}]
                                   if created else []])
            if args[:2] == ('release', 'create'):
                created = True
            elif args[:3] == ('api', '--method', 'POST'):
                self.assertIn('/releases/42/assets?', args[3])
                path = Path(args[args.index('--input') + 1])
                remote.append({'name': path.name, 'size': path.stat().st_size,
                    'digest': 'sha256:' + hashlib.sha256(path.read_bytes()).hexdigest()})
            elif args[0] == 'api':
                return json.dumps({'tag_name': self.tag, 'draft': True, 'prerelease': False, 'assets': remote})
            return ''
        self.run_publish(checked)
        self.assertEqual(len(remote), 5)
        edit = next(args for args in calls if args[:3] == ('api', '--method', 'PATCH'))
        self.assertEqual(edit[3], 'repos/BrowserOperator/browser-operator-releases/releases/42')
        self.assertIn('prerelease=false', edit)
        self.assertIn('draft=false', edit)
        catalog = json.loads((self.candidate / 'catalog-github.json').read_text())
        self.assertEqual(catalog['channel'], 'stable')
        self.assertIn('/' + self.tag + '/', catalog['apps'][0]['crx']['url'])


if __name__ == '__main__':
    unittest.main()
