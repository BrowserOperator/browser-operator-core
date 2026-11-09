#!/usr/bin/env python3
"""Probe the notarized, isolated 158 app against the local signed service."""

import argparse
from pathlib import Path
import shutil
import socket
import subprocess
import time
import urllib.request

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--version', default='158.0.8127.18')
parser.add_argument('--status', default='updated')
parser.add_argument('--stage', default='baseline-verification')
parser.add_argument('--profile-sentinel', choices=('seed', 'check'))
parser.add_argument('--launch-via-services', action='store_true',
                    help='Use normal macOS app launch for first-run updater setup')
options = parser.parse_args()
if Path(options.stage).name != options.stage or options.stage in ('.', '..'):
    parser.error('stage must be a single directory name')
root = Path.home() / 'chromium/updater-test'
app = root / 'install/Browser Operator.app'
profile = root / 'profile'
artifacts = root / options.stage
artifacts.mkdir(exist_ok=True)
with socket.socket() as server:
    server.bind(('127.0.0.1', 0))
    port = server.getsockname()[1]
scripts = Path(__file__).resolve().parents[1]
with (artifacts / 'browser.log').open('a') as log:
    browser_arguments = [
        '--user-data-dir=' + str(profile), '--use-mock-keychain',
        '--no-first-run', '--no-default-browser-check', '--lang=en-US',
        '--remote-debugging-address=127.0.0.1', f'--remote-debugging-port={port}',
        'about:blank',
    ]
    if options.launch_via_services:
        subprocess.run(['open', '-n', '-a', str(app), '--args', *browser_arguments],
                       check=True, stdout=log, stderr=subprocess.STDOUT)
        browser = None
    else:
        browser = subprocess.Popen([
            str(app / 'Contents/MacOS/Browser Operator'), '--headless=new', *browser_arguments,
        ], stdout=log, stderr=subprocess.STDOUT)
    try:
        endpoint = f'http://127.0.0.1:{port}'
        for _ in range(120):
            if browser is not None and browser.poll() is not None:
                raise RuntimeError('Isolated baseline browser exited')
            try:
                with urllib.request.urlopen(endpoint + '/json/version', timeout=1):
                    break
            except OSError:
                time.sleep(.25)
        else:
            raise RuntimeError('Isolated baseline did not start')
        print('Isolated baseline CDP:', endpoint, flush=True)
        if options.profile_sentinel:
            subprocess.run([shutil.which('node'), str(scripts / 'updater/profile_sentinel.mjs'),
                            endpoint, options.profile_sentinel, str(artifacts)], check=True)
        subprocess.run([shutil.which('node'), str(scripts / 'verify_chromium_release.mjs'),
                        endpoint, options.version, str(artifacts)], check=True)
        subprocess.run([shutil.which('node'), str(scripts / 'updater/verify_browser_updater.mjs'),
                        endpoint, options.version, options.status, str(artifacts)], check=True)
    finally:
        if browser is None or browser.poll() is None:
            try:
                subprocess.run([shutil.which('node'), str(scripts / 'updater/close_browser.mjs'),
                                endpoint], check=True, timeout=10)
            except (OSError, subprocess.SubprocessError):
                if browser is not None:
                    browser.terminate()
        if browser is not None:
            try:
                browser.wait(timeout=15)
            except subprocess.TimeoutExpired:
                browser.kill()
                browser.wait()
