#!/usr/bin/env python3
"""Sync an already-selected Chromium revision without crossing the frontend link."""

import argparse
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--chromium-src', required=True, type=Path)
    parser.add_argument('--revision', required=True)
    parser.add_argument('--log', required=True, type=Path)
    parser.add_argument('--min-free-gib', type=float, default=5)
    parser.add_argument('--jobs', type=int, default=4)
    args = parser.parse_args()
    source = args.chromium_src.resolve()
    if not re.fullmatch(r'[0-9a-f]{40}', args.revision):
        parser.error('revision must be a pinned full Git commit')
    if args.jobs < 1 or args.min_free_gib <= 0:
        parser.error('jobs and min-free-gib must be positive')
    frontend = source / 'third_party/devtools-frontend/src'
    if frontend.is_symlink() or not (frontend / '.git').exists():
        raise RuntimeError('Restore the stock DevTools Git checkout before syncing')
    current = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()
    if current != args.revision:
        raise RuntimeError('Select and back up the requested source revision before syncing')
    # Existing dependencies still point at the previous release until sync.
    # gclient independently refuses dirty dependency worktrees.
    if subprocess.check_output(['git', 'diff', '--ignore-submodules=all', '--name-only', 'HEAD'], cwd=source):
        raise RuntimeError('Preserve local tracked source changes before syncing')
    minimum = args.min_free_gib * 1024**3
    if shutil.disk_usage(source).free < minimum:
        raise RuntimeError('Insufficient disk space to start dependency sync')
    environment = dict(os.environ)
    environment['DEPOT_TOOLS_UPDATE'] = '0'
    environment['BROWSER_OPERATOR_REAL_GIT'] = '/Applications/Xcode.app/Contents/Developer/usr/bin/git'
    environment['DEVELOPER_DIR'] = '/Applications/Xcode.app/Contents/Developer'
    wrapper = Path(__file__).resolve().parent / 'chromium_sync_git'
    environment['PATH'] = os.pathsep.join((str(wrapper), str(source / 'third_party/depot_tools'), environment.get('PATH', '')))
    args.log.parent.mkdir(parents=True, exist_ok=True)
    subprocess.Popen(['/usr/bin/caffeinate', '-i', '-w', str(os.getpid())])
    with args.log.open('a') as log:
        process = subprocess.Popen([
            str(source / 'third_party/depot_tools/gclient'), 'sync', '--no-history', '--shallow',
            '--revision', 'src@' + args.revision, '--jobs', str(args.jobs),
        ], cwd=source.parent, env=environment, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            while process.poll() is None:
                if shutil.disk_usage(source).free < minimum:
                    raise RuntimeError('Free-space guard stopped sync; fetched dependencies are retained')
                time.sleep(5)
            if process.returncode:
                raise RuntimeError(f'gclient exited {process.returncode}; inspect {args.log}')
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGINT)
                try:
                    process.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.wait()
    print('Pinned dependency sync and hooks completed', flush=True)


if __name__ == '__main__':
    main()
