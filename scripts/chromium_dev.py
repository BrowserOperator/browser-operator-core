#!/usr/bin/env python3
"""Build and launch Browser Operator using tools from a local Chromium checkout."""

import argparse
import functools
import http.server
import platform
from pathlib import Path
import shutil
import socketserver
import subprocess
import threading


ROOT = Path(__file__).resolve().parents[1]


class FrontendServer(http.server.ThreadingHTTPServer):
    # Unbundled DevTools starts hundreds of module requests simultaneously.
    request_queue_size = 512
    daemon_threads = True

    def server_bind(self):
        # HTTPServer's reverse DNS lookup can stall on offline development hosts.
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = self.server_address[:2]


def link_dependency(destination, source, copy=False):
    if destination.exists():
        if destination.is_dir() and not destination.is_symlink() and not any(destination.iterdir()):
            destination.rmdir()
        else:
            return
    if destination.is_symlink():
        raise RuntimeError(f"Broken dependency link: {destination}")
    if not source.exists():
        raise RuntimeError(f"Missing Chromium dependency: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if copy:
        shutil.copytree(source, destination, symlinks=True)
    else:
        destination.symlink_to(source, target_is_directory=True)


def prepare(chromium):
    # Chromium's build/config/gclient_args.gni says build_with_chromium=true.
    # Copy build support so standalone configuration never changes the fork.
    build = ROOT / 'build'
    if not build.exists() or (build.is_dir() and not any(build.iterdir())):
        if build.exists():
            build.rmdir()
        shutil.copytree(chromium / 'build', build, symlinks=True)
        (build / 'config/gclient_args.gni').write_text('build_with_chromium = false\n')
    if build.is_symlink():
        raise RuntimeError('Standalone build/ must not be a symlink to Chromium build/.')
    link_dependency(ROOT / 'buildtools', chromium / 'buildtools', copy=True)
    link_dependency(ROOT / 'third_party/inspector_protocol', chromium / 'third_party/inspector_protocol', copy=True)
    link_dependency(ROOT / 'third_party/esbuild', chromium / 'third_party/devtools-frontend/src/third_party/esbuild')
    node_platform = 'mac_arm64' if platform.machine() == 'arm64' else 'mac'
    link_dependency(ROOT / 'third_party/node' / node_platform, chromium / 'third_party/node' / node_platform)
    if not (ROOT / 'node_modules/typescript/lib/tsc.js').exists():
        raise RuntimeError('Install dependencies first: npm install --legacy-peer-deps '
                           '--package-lock=false --registry=https://registry.npmjs.org')


def find_browser(chromium, explicit):
    if explicit:
        candidates = [Path(explicit).expanduser()]
    else:
        candidates = [chromium / f'out/{target}/{app}.app/Contents/MacOS/{app}'
                      for target in ('BrowserOperator', 'Default', 'Release', 'Debug')
                      for app in ('Browser Operator', 'Chromium')]
        candidates += [Path(f'/Applications/{app}.app/Contents/MacOS/{app}')
                       for app in ('Browser Operator', 'Chromium', 'Google Chrome Canary', 'Google Chrome')]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise RuntimeError('No browser binary found; provide --browser /path/to/executable.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chromium-src', type=Path, default=Path.home() / 'chromium/src')
    parser.add_argument('--browser', help='Browser executable; compiled fork preferred by default')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--debug-port', type=int, default=9222)
    parser.add_argument('--skip-build', action='store_true')
    parser.add_argument('--build-only', action='store_true')
    parser.add_argument('--typecheck', action='store_true', help='Enable full TypeScript checking')
    parser.add_argument('url', nargs='?', default='about:blank')
    args = parser.parse_args()
    chromium = args.chromium_src.expanduser().resolve()
    if not args.skip_build:
        prepare(chromium)
        gn_args = 'use_siso=false devtools_bundle=false devtools_skip_typecheck=' + ('false' if args.typecheck else 'true')
        subprocess.run([str(chromium / 'buildtools/mac/gn'), 'gen', 'out/Default',
                        '--args=' + gn_args], cwd=ROOT, check=True)
        subprocess.run([str(chromium / 'third_party/ninja/ninja'), '-C', 'out/Default',
                        'devtools_frontend_resources', '-j', '8'], cwd=ROOT, check=True)
    if args.build_only:
        return
    frontend = ROOT / 'out/Default/gen/front_end'
    if not (frontend / 'devtools_app.html').is_file():
        raise RuntimeError('Frontend output missing; run without --skip-build.')
    browser = find_browser(chromium, args.browser)
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(frontend))
    server = FrontendServer(('127.0.0.1', args.port), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    # Persistent development profile, separate from the user's regular browser.
    profile = ROOT / 'out/browser-operator-profile'
    command = [str(browser), f'--user-data-dir={profile}', '--no-first-run',
               '--no-default-browser-check', '--remote-debugging-address=127.0.0.1',
               f'--remote-debugging-port={args.debug_port}',
               f'--custom-devtools-frontend=http://127.0.0.1:{server.server_port}/',
               '--auto-open-devtools-for-tabs', args.url]
    print(f'Browser: {browser}\nFrontend: http://127.0.0.1:{server.server_port}/\n'
          f'Development profile: {profile}', flush=True)
    process = None
    try:
        process = subprocess.Popen(command)
        returncode = process.wait()
        if returncode:
            raise RuntimeError(f'Browser exited with status {returncode}')
    except KeyboardInterrupt:
        if process is not None:
            process.terminate()
            process.wait()
    finally:
        server.shutdown()
        server.server_close()


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
