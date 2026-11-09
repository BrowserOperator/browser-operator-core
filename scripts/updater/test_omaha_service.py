#!/usr/bin/env python3
"""Qualify the service using Chromium's real CUP/CRX verification binaries."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from urllib.parse import urlencode
import zipfile

import omaha_service as service

KEYS = Path('/Users/tyson/chromium/browser-operator-updater-private/test-keys')
BUILD = Path('/Users/tyson/chromium/src/out/Release')


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.app = 'com.browseroperator.BrowserOperator'
        self.catalog = {'channel': 'autoupdate-test', 'apps': [{
            'appid': self.app, 'version': '159.0.8144.0',
            'crx': {'name': 'browser-159.crx3', 'sha256': 'ab' * 32, 'size': 120},
        }]}
        self.request = {'request': {'protocol': '4.0',
            'os': {'platform': 'mac', 'arch': 'arm64'},
            'apps': [{'appid': self.app, 'version': '158.0.8127.18', 'updatecheck': {}}]}}

    def status(self):
        return service.response_for(self.request, self.catalog, 'http://127.0.0.1:18158/download')[
            'response']['apps'][0]['updatecheck']

    def test_offer_real_major_version_upgrade(self):
        update = self.status()
        self.assertEqual(update['nextversion'], '159.0.8144.0')
        operations = update['pipelines'][0]['operations']
        self.assertEqual([op['type'] for op in operations], ['download', 'crx3'])
        # macOS dispatches a .app path to InstallFromApp, which runs the
        # sibling .install script with the archive directory and registered
        # application path. Passing the script itself would not do this.
        self.assertEqual(operations[1]['path'], 'Browser Operator.app')
        self.assertEqual(operations[0]['out'], operations[1]['in'])

    def test_never_offer_same_version_or_downgrade(self):
        for current in ('159.0.8144.0', '159.0.8150.0', '160.0.1.0'):
            with self.subTest(current=current):
                self.request['request']['apps'][0]['version'] = current
                self.assertEqual(self.status(), {'status': 'noupdate'})

    def test_native_macos_platform_name_is_supported(self):
        self.request['request']['os']['platform'] = 'Mac OS X'
        self.assertEqual(self.status()['nextversion'], '159.0.8144.0')

    def test_wrong_platform_and_architecture_have_no_update(self):
        for platform, architecture in [('win', 'arm64'), ('linux', 'arm64'), ('mac', 'x86_64')]:
            with self.subTest(platform=platform, architecture=architecture):
                self.request['request']['os'] = {'platform': platform, 'arch': architecture}
                self.assertEqual(self.status(), {'status': 'noupdate'})

    def test_unknown_app_has_no_update(self):
        self.request['request']['apps'][0]['appid'] = 'org.chromium.Chromium'
        self.assertEqual(self.status(), {'status': 'noupdate'})

    def test_invalid_versions_rejected(self):
        for value in ('159.0.1.0-beta', '-1', '1.2.3.4.5', '4294967296'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                service.version(value)

    def test_catalog_rejects_modified_payload_or_escape(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'browser-159.crx3').write_bytes(b'modified payload')
            path = root / 'catalog.json'
            path.write_text(json.dumps(self.catalog))
            with self.assertRaises(ValueError):
                service.load_catalog(path, root)
            self.catalog['apps'][0]['crx']['name'] = '../outside.crx3'
            path.write_text(json.dumps(self.catalog))
            with self.assertRaises(ValueError):
                service.load_catalog(path, root)


class NativeCryptoTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.verify = BUILD / 'browser_operator_update_verify'
        cls.builder = BUILD / 'crx3_build_action'
        if not cls.verify.is_file() or not cls.builder.is_file():
            raise RuntimeError('Build native verifier and CRX builder before crypto qualification')

    def verify_cup(self, root, request, response, proof):
        for name, content in [('request', request), ('response', response), ('proof', proof.encode())]:
            (root / name).write_bytes(content)
        return subprocess.run([str(self.verify), 'cup', str(KEYS / 'cup.public.der'),
            str(root / 'request'), str(root / 'response'), str(root / 'proof')],
            capture_output=True).returncode

    def test_native_cup_accepts_signature_rejects_tamper_and_replay(self):
        request = b'{"request":{"protocol":"4.0","apps":[]}}'
        response = b")]}'\n{\"response\":{\"protocol\":\"4.0\",\"apps\":[]}}"
        params = {'cup2key': 'ML-DSA-44-1:12345',
                  'cup2hreq': hashlib.sha256(request).hexdigest()}
        proof = service.sign_response(request, response, urlencode(params),
                                      KEYS / 'cup.pem', '/opt/homebrew/bin/openssl')
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertEqual(self.verify_cup(root, request, response, proof), 0)
            self.assertEqual(self.verify_cup(root, request, response + b' ', proof), 1)
            self.assertEqual(self.verify_cup(root, request + b' ', response, proof), 1)
            params['cup2key'] = 'ML-DSA-44-1:54321'
            replay = service.sign_response(request, response, urlencode(params),
                                           KEYS / 'cup.pem', '/opt/homebrew/bin/openssl')
            self.assertEqual(self.verify_cup(root, request, response, replay), 1)

    def test_native_crx_accepts_pinned_key_rejects_tamper_and_wrong_key(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive, package = root / 'update.zip', root / 'update.crx3'
            with zipfile.ZipFile(archive, 'w') as zipped:
                zipped.writestr('.install', '#!/bin/sh\nexit 0\n')
            subprocess.run([str(self.builder), str(package), str(archive),
                            str(KEYS / 'crx.pkcs8.der')], check=True)
            pin = hashlib.sha256((KEYS / 'crx.public.der').read_bytes()).hexdigest()
            def verify(key):
                return subprocess.run([str(self.verify), 'crx', str(package), key],
                                      capture_output=True).returncode
            self.assertEqual(verify(pin), 0)
            self.assertEqual(verify('00' * 32), 1)
            data = bytearray(package.read_bytes())
            data[-1] ^= 1
            package.write_bytes(data)
            self.assertEqual(verify(pin), 1)


class HttpTests(unittest.TestCase):
    def test_unsigned_event_ack_does_not_allow_unsigned_update_check(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            catalog = root / 'catalog.json'
            catalog.write_text(json.dumps({'channel': 'autoupdate-test', 'apps': []}))
            server = service.ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
            server.catalog, server.artifacts = catalog, root
            server.key = root / 'not-used.pem'
            server.openssl, server.fault = '/opt/homebrew/bin/openssl', 'none'
            server.download_base = 'http://127.0.0.1/download'
            thread = threading.Thread(target=server.serve_forever)
            thread.start()
            try:
                app = {'appid': 'com.browseroperator.BrowserOperator',
                       'version': '158.0.8127.18', 'events': [{'eventtype': 3}]}
                def request():
                    raw = json.dumps({'request': {'protocol': '4.0', 'apps': [app]}}).encode()
                    return urllib.request.urlopen(urllib.request.Request(
                        f'http://127.0.0.1:{server.server_port}/service/update2/json', data=raw), timeout=5)
                with request() as response:
                    self.assertEqual(response.status, 200)
                    self.assertIsNone(response.headers.get('X-Cup-Server-Proof'))
                app['updatecheck'] = {}
                with self.assertRaises(urllib.error.HTTPError) as rejected:
                    request()
                self.assertEqual(rejected.exception.code, 400)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--protocol-only', action='store_true')
    options = parser.parse_args()
    suite = unittest.TestLoader().loadTestsFromTestCase(ProtocolTests)
    suite.addTests(unittest.TestLoader().loadTestsFromTestCase(HttpTests))
    if not options.protocol_only:
        suite.addTests(unittest.TestLoader().loadTestsFromTestCase(NativeCryptoTests))
    raise SystemExit(not unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful())
