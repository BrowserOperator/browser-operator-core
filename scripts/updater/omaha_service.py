#!/usr/bin/env python3
"""Loopback Omaha 4 / CUP qualification service for Browser Operator.

Uses ML-DSA-44 response signatures and signed CRX3 downloads. This local test
service is not a public deployment; it never disables client verification.
"""

import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import parse_qs, urlsplit


def version(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d+(?:\.\d+){0,3}', value):
        raise ValueError('Invalid browser version')
    fields = tuple(map(int, value.split('.')))
    if any(field >= 2**32 for field in fields):
        raise ValueError('Version component exceeds protocol limit')
    return fields + (0,) * (4 - len(fields))


def cup_message(request, response, cup_key):
    return hashlib.sha256(hashlib.sha256(request).digest() +
                          hashlib.sha256(response).digest() + cup_key.encode()).digest()


def sign_response(request, response, query, private_key, openssl):
    params = parse_qs(query, strict_parsing=True)
    if set(params) != {'cup2key', 'cup2hreq'} or any(len(v) != 1 for v in params.values()):
        raise ValueError('Missing or repeated CUP parameters')
    cup_key = params['cup2key'][0]
    if not re.fullmatch(r'ML-DSA-44-1:[A-Za-z0-9_-]{1,128}', cup_key):
        raise ValueError('Unrecognized CUP signing key or nonce')
    request_hash = hashlib.sha256(request).hexdigest()
    if params['cup2hreq'][0] != request_hash:
        raise ValueError('CUP request digest mismatch')
    with tempfile.TemporaryDirectory(prefix='browser-operator-cup-') as temp:
        data, proof = Path(temp) / 'message', Path(temp) / 'signature'
        data.write_bytes(cup_message(request, response, cup_key))
        subprocess.run([openssl, 'pkeyutl', '-sign', '-rawin', '-inkey', str(private_key),
                        '-in', str(data), '-out', str(proof)],
                       check=True, capture_output=True, timeout=30)
        signature = proof.read_bytes()
    if len(signature) != 2420:
        raise ValueError('CUP signing key is not ML-DSA-44')
    return '"' + signature.hex() + ':' + request_hash + '"'


def response_for(request, catalog, download_base):
    root = request.get('request', {})
    if root.get('protocol') != '4.0':
        raise ValueError('Expected Omaha protocol 4.0')
    os_info = root.get('os', {})
    compatible = (os_info.get('platform', '').strip().lower() in ('mac', 'macos', 'macosx', 'mac os x') and
                  os_info.get('arch', '').lower() in ('arm64', 'aarch64'))
    applications = root.get('apps', [])
    if not isinstance(applications, list) or len(applications) > 100:
        raise ValueError('Invalid application list')
    releases = {entry['appid'].lower(): entry for entry in catalog.get('apps', [])}
    result = []
    for application in applications:
        app_id = application['appid']
        item = {'appid': app_id, 'status': 'ok'}
        if 'updatecheck' in application:
            item['updatecheck'] = {'status': 'noupdate'}
            candidate = releases.get(app_id.lower())
            if compatible and candidate and version(candidate['version']) > version(application['version']):
                package = candidate['crx']
                url = package.get('url') or download_base + '/' + package['name']
                item['updatecheck'] = {
                    'status': 'ok', 'nextversion': candidate['version'],
                    'pipelines': [{'operations': [
                        {'type': 'download', 'urls': [{'url': url}],
                         'size': package['size'], 'out': {'sha256': package['sha256']}},
                        {'type': 'crx3', 'in': {'sha256': package['sha256']},
                         'path': 'Browser Operator.app'},
                    ]}],
                }
        if 'events' in application:
            item['events'] = [{'status': 'ok'} for _ in application['events']]
        result.append(item)
    return {'response': {'protocol': '4.0', 'apps': result}}


def load_catalog(path, artifacts):
    catalog = json.loads(path.read_text())
    if catalog.get('channel') != 'autoupdate-test':
        raise ValueError('This service requires the isolated test channel')
    seen = set()
    for entry in catalog.get('apps', []):
        if entry['appid'].lower() in seen:
            raise ValueError('Duplicate application identifier')
        seen.add(entry['appid'].lower())
        version(entry['version'])
        package = entry['crx']
        if not re.fullmatch(r'[A-Za-z0-9._-]+\.crx3', package['name']):
            raise ValueError('Unsafe CRX filename')
        if not re.fullmatch(r'[a-f0-9]{64}', package['sha256']) or package['size'] <= 0:
            raise ValueError('Invalid CRX digest or size')
        if package.get('url'):
            url = urlsplit(package['url'])
            if url.scheme != 'https' or url.netloc != 'github.com' or not url.path.startswith(
                    '/BrowserOperator/browser-operator-releases/releases/download/'):
                raise ValueError('Unexpected release download origin')
        else:
            archive = (artifacts / package['name']).resolve()
            if archive.parent != artifacts.resolve():
                raise ValueError('Package escapes the artifact directory')
            with archive.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            if digest != package['sha256'] or archive.stat().st_size != package['size']:
                raise ValueError('Local CRX differs from the verified catalog')
    return catalog


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # Do not log request identifiers, user data, or signing material.

    def do_POST(self):
        try:
            parsed = urlsplit(self.path)
            if parsed.path != '/service/update2/json':
                self.send_error(404)
                return
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 1024 * 1024:
                raise ValueError('Invalid request length')
            raw = self.rfile.read(length)
            request = json.loads(raw)
            catalog = load_catalog(self.server.catalog, self.server.artifacts)
            response = b")]}'\n" + json.dumps(response_for(
                request, catalog, self.server.download_base), separators=(',', ':')).encode()
            # Chromium deliberately sends event-only pings without CUP. They
            # can only acknowledge events; any request containing an update
            # check still requires authenticated CUP parameters.
            has_update_check = any('updatecheck' in app
                                   for app in request['request'].get('apps', []))
            proof = (sign_response(raw, response, parsed.query, self.server.key, self.server.openssl)
                     if has_update_check or parsed.query else None)
            if self.server.fault == 'invalid-cup' and proof:
                proof = '"' + ('00' if proof[1:3] != '00' else 'ff') + proof[3:]
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            if proof:
                self.send_header('X-Cup-Server-Proof', proof)
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response)
            requested = {app['appid'].lower(): app.get('version')
                         for app in request['request'].get('apps', [])}
            print(json.dumps({'event': 'response', 'fault': self.server.fault,
                'os': {key: request['request'].get('os', {}).get(key)
                       for key in ('platform', 'arch')}, 'apps': [
                {'appid': app['appid'], 'current_version': requested.get(app['appid'].lower()),
                 'status': app.get('updatecheck', {}).get('status'),
                 'next_version': app.get('updatecheck', {}).get('nextversion')}
                for app in json.loads(response[5:])['response']['apps']]}), flush=True)
        except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as error:
            print(json.dumps({'event': 'request-failed', 'type': type(error).__name__,
                              'reason': str(error)}), flush=True)
            self.send_error(400, 'Invalid update request or catalog')

    def do_GET(self):
        catalog = load_catalog(self.server.catalog, self.server.artifacts)
        allowed = {('/download/' + entry['crx']['name']): entry['crx']['name']
                   for entry in catalog.get('apps', []) if not entry['crx'].get('url')}
        name = allowed.get(urlsplit(self.path).path)
        if not name:
            self.send_error(404)
            return
        archive = self.server.artifacts / name
        self.send_response(200)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Content-Length', str(archive.stat().st_size))
        self.end_headers()
        with archive.open('rb') as stream:
            first = True
            while chunk := stream.read(1024 * 1024):
                if first and self.server.fault == 'corrupt-download':
                    chunk = bytes([chunk[0] ^ 1]) + chunk[1:]
                self.wfile.write(chunk)
                first = False
        print(json.dumps({'event': 'download', 'name': name}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog', required=True, type=Path)
    parser.add_argument('--artifacts', required=True, type=Path)
    parser.add_argument('--cup-key', required=True, type=Path)
    parser.add_argument('--openssl', default='/opt/homebrew/bin/openssl')
    parser.add_argument('--port', type=int, default=18158)
    parser.add_argument('--fault', choices=('none', 'invalid-cup', 'corrupt-download'), default='none')
    args = parser.parse_args()
    load_catalog(args.catalog, args.artifacts)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    server.catalog, server.artifacts, server.key = args.catalog, args.artifacts, args.cup_key
    server.openssl, server.fault = args.openssl, args.fault
    server.download_base = f'http://127.0.0.1:{server.server_port}/download'
    print(f'Isolated Omaha service listening on 127.0.0.1:{server.server_port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
