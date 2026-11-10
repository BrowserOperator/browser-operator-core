#!/usr/bin/env python3
"""Build the local Chromium release app, stopping before disk space is exhausted."""

import argparse
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time


def show_progress(log):
    with log.open('rb') as stream:
        stream.seek(max(0, log.stat().st_size - 8192))
        lines = stream.read().decode('utf-8', errors='replace').splitlines()
    if lines:
        print(lines[-1][:300], flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chromium-src', type=Path, required=True)
    parser.add_argument('--build-dir', type=Path,
                        help='Defaults to out/Release for ARM64 or out/Release_x64 for Intel')
    parser.add_argument('--target-cpu', choices=('arm64', 'x64'), default='arm64')
    parser.add_argument('--jobs', type=int, default=6)
    parser.add_argument('--min-free-gib', type=float, default=5)
    parser.add_argument('--log', type=Path, required=True)
    parser.add_argument('--gn-config', help='Defaults to the production release config for target-cpu')
    parser.add_argument('--extra-target', action='append', default=[])
    args = parser.parse_args()
    if args.jobs < 1 or args.min_free_gib <= 0:
        parser.error('jobs and min-free-gib must be positive')
    source = args.chromium_src.expanduser().resolve()
    if args.build_dir is None:
        args.build_dir = Path('out/Release' if args.target_cpu == 'arm64' else 'out/Release_x64')
    if args.gn_config is None:
        args.gn_config = f'//third_party/devtools-frontend/src/config/chromium-release-mac-{args.target_cpu}.gn'
    build = (source / args.build_dir).resolve()
    if args.build_dir.is_absolute() or not build.is_relative_to(source / 'out'):
        parser.error('build-dir must be a directory under the Chromium out tree')
    if not args.gn_config.startswith('//') or any(c in args.gn_config for c in ('"', '\n', '\r')):
        parser.error('gn-config must be a GN source-root path')
    if not (source / 'chrome/VERSION').is_file():
        raise RuntimeError('chromium-src must point to a Chromium source checkout')
    minimum = args.min_free_gib * 1024**3
    if shutil.disk_usage(source).free < minimum:
        raise RuntimeError('Insufficient free disk space to start the build')
    environment = dict(os.environ)
    environment['PATH'] = str(source / 'third_party/depot_tools') + os.pathsep + environment.get('PATH', '')
    environment['DEPOT_TOOLS_UPDATE'] = '0'
    environment.setdefault('DEVELOPER_DIR', '/Applications/Xcode.app/Contents/Developer')
    # Match the profile pinned by this Chromium version, without syncing over
    # the external DevTools frontend symlink or guessing a profile filename.
    subprocess.run([
        sys.executable, str(source / 'tools/update_pgo_profiles.py'),
        '--target=' + ('mac-arm' if args.target_cpu == 'arm64' else 'mac'), 'update',
        '--gs-url-base=chromium-optimization-profiles/pgo_profiles',
    ], cwd=source, env=environment, check=True)
    subprocess.run([
        sys.executable, str(source / 'v8/tools/builtins-pgo/download_profiles.py'),
        'download', '--depot-tools', str(source / 'third_party/depot_tools'),
        '--check-v8-revision', '--quiet',
    ], cwd=source, env=environment, check=True)
    gn_args = f'import("{args.gn_config}")'
    subprocess.run([str(source / 'buildtools/mac/gn'), 'gen', str(build), '--args=' + gn_args],
                   cwd=source, env=environment, check=True)
    # GN inspection rewrites gn_logs.txt, an input of the license generator.
    # Capture settings before Ninja so packaging can read them without making
    # an otherwise completed build stale again.
    from package_chromium_release import capture_shipping_settings
    settings = capture_shipping_settings(source, build)
    if settings['target_cpu'] != '"' + args.target_cpu + '"':
        raise RuntimeError('GN configuration target_cpu differs from the requested architecture')
    from chromium_build_input import release_targets
    targets = list(dict.fromkeys([*release_targets(settings), *args.extra_target]))
    log = args.log.expanduser().resolve()
    log.parent.mkdir(parents=True, exist_ok=True)
    print(f'Release build: {build}\nLog: {log}\n'
          f'Stopping if free space falls below {args.min_free_gib:g} GiB', flush=True)
    if Path('/usr/bin/caffeinate').exists():
        # This assertion expires with the runner, including error exits.
        subprocess.Popen(['/usr/bin/caffeinate', '-i', '-w', str(os.getpid())])
    with log.open('a') as output:
        process = subprocess.Popen(
            [str(source / 'third_party/ninja/ninja'), '-C', str(build),
             *targets, '-j', str(args.jobs)],
            cwd=source, env=environment, stdout=output, stderr=subprocess.STDOUT,
            start_new_session=True)
        try:
            next_progress = time.monotonic() + 30
            while process.poll() is None:
                if shutil.disk_usage(source).free < minimum:
                    raise RuntimeError('Free-space guard stopped the build; completed outputs are retained')
                if time.monotonic() >= next_progress:
                    show_progress(log)
                    next_progress = time.monotonic() + 30
                time.sleep(5)
            if process.returncode:
                raise RuntimeError(f'Ninja exited with status {process.returncode}; inspect {log}')
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGINT)
                try:
                    process.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.wait()
    print('Release build completed successfully', flush=True)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        raise SystemExit(130) from None
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
