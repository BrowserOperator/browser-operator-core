#!/usr/bin/env python3
"""Verify an empty production feed through HTTPS with Chromium's real CUP verifier."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from urllib.parse import urlencode, urlsplit
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--endpoint', required=True)
    parser.add_argument('--public-key', required=True, type=Path)
    parser.add_argument('--verifier', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    url = urlsplit(args.endpoint)
    if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment:
        parser.error('Use an HTTPS endpoint without credentials, query or fragment')
    args.output.mkdir(parents=True, exist_ok=False)
    results = []
    for architecture in ('arm64', 'x86_64'):
        root = args.output / architecture
        root.mkdir()
        request = json.dumps({'request': {'protocol': '4.0',
            'os': {'platform': 'Mac OS X', 'arch': architecture},
            'apps': [{'appid': 'com.browseroperator.BrowserOperator',
                      'version': '158.0.8127.18', 'updatecheck': {}}]}}, separators=(',', ':')).encode()
        query = urlencode({'cup2key': 'ML-DSA-44-1:12345', 'cup2hreq': hashlib.sha256(request).hexdigest()})
        call = urllib.request.Request(args.endpoint + '?' + query, data=request,
                                      headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(call, timeout=45) as stream:
            response = stream.read()
            proof = stream.headers.get('X-Cup-Server-Proof')
            if stream.status != 200:
                raise RuntimeError(f'Unexpected update-server HTTP status: {stream.status}')
        if not proof or not response.startswith(b")]}'\n"):
            raise RuntimeError('Missing native CUP proof or Omaha response prefix')
        for name, data in [('request', request), ('response', response), ('proof', proof.encode())]:
            (root / name).write_bytes(data)
        command = [str(args.verifier), 'cup', str(args.public_key), str(root / 'request'),
                   str(root / 'response'), str(root / 'proof')]
        subprocess.run(command, check=True)
        (root / 'response').write_bytes(response + b' ')
        rejected = subprocess.run(command, capture_output=True).returncode
        (root / 'response').write_bytes(response)
        if rejected != 1:
            raise RuntimeError('Native verifier did not reject a tampered response')
        apps = json.loads(response[5:])['response']['apps']
        if len(apps) != 1 or apps[0]['updatecheck'] != {'status': 'noupdate'}:
            raise RuntimeError('Expected a deliberately empty production feed')
        results.append({'architecture': architecture, 'https': 'verified', 'native_cup': 'accepted',
                        'tampered_response': 'rejected', 'status': 'noupdate', 'proof_bytes': len(proof)})
    report = {'endpoint': args.endpoint, 'client_verifier': str(args.verifier),
              'cup_public_sha256': hashlib.sha256(args.public_key.read_bytes()).hexdigest(),
              'results': results}
    (args.output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
