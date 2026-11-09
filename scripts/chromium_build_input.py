"""Validate immutable signing inputs and completed native build products."""

import hashlib
import json
import stat
import subprocess


def inventory(root):
    entries = {}
    for path in sorted(root.rglob('*')):
        name = path.relative_to(root).as_posix()
        if name == 'frozen-input.json':
            continue
        if path.is_symlink():
            entries[name] = {'link': str(path.readlink())}
        elif path.is_file():
            with path.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            entries[name] = {'sha256': digest, 'mode': stat.S_IMODE(path.stat().st_mode)}
    return entries


def load(root):
    metadata = json.loads((root / 'frozen-input.json').read_text())
    if metadata.get('schema') != 1 or metadata['input_files'] != inventory(root):
        raise RuntimeError('Frozen signing input is incomplete or has changed')
    return metadata


def require_current_build(source, build, targets):
    command = [
        str(source / 'third_party/ninja/ninja'), '-n', '-C', str(build),
        *targets,
    ]
    planned = subprocess.check_output(command, cwd=source, text=True)
    # `gn args --list` can rewrite generated gn_logs.txt, making only the
    # graph stale. Regenerate the graph, then still refuse actual build work.
    if 'Regenerating ninja files' in planned:
        # Let Ninja run its generator so the restat mtime in .ninja_log is
        # refreshed too; a direct `gn gen` does not refresh that record.
        subprocess.run([str(source / 'third_party/ninja/ninja'), '-C', str(build), 'build.ninja'],
                       cwd=source, check=True, stdout=subprocess.DEVNULL)
        planned = subprocess.check_output(command, cwd=source, text=True)
    if 'ninja: no work to do.' not in planned:
        raise RuntimeError('Build products must be current before signing or freezing input')
