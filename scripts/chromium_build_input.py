"""Validate immutable signing inputs and completed native build products."""

import hashlib
import json
import base64
from pathlib import Path
import re
import stat
import subprocess

from chromium_git import git_environment


def source_state(root):
    """Record tracked edits and untracked source/assets, including the external frontend."""
    patch = subprocess.check_output(['git', 'diff', '--binary', '--no-ext-diff', '--no-textconv', 'HEAD', '--ignore-submodules=all'], cwd=root, env=git_environment())
    untracked = {}
    names = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '-z'], cwd=root, env=git_environment())
    for raw in names.split(b'\0'):
        if not raw:
            continue
        name = raw.decode()
        path = root / name
        if path.is_symlink():
            untracked[name] = {'link': str(path.readlink())}
        elif path.is_file():
            with path.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            untracked[name] = {'sha256': digest, 'mode': stat.S_IMODE(path.stat().st_mode)}
        # Nested dependency Git repositories are managed by the pinned DEPS,
        # not treated as untracked browser modifications.
    dependencies = {}
    index = subprocess.check_output(['git', 'ls-files', '--stage', '-z'], cwd=root, env=git_environment())
    for record in index.split(b'\0'):
        metadata, _, raw_path = record.partition(b'\t')
        if not metadata.startswith(b'160000 ') or not raw_path:
            continue
        name = raw_path.decode()
        child = root / name
        if child.is_dir() and not child.is_symlink() and (child / '.git').exists():
            dependencies[name] = source_state(child)
            dependencies[name]['gitlink_revision'] = metadata.split()[1].decode()
    return {'revision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True, env=git_environment()).strip(),
            'patch_sha256': hashlib.sha256(patch).hexdigest(), 'untracked_source_files': untracked,
            'dependency_source_states': dependencies}


def updater_trust(source, settings):
    config = settings['browser_operator_updater_config'].strip('"')
    if not config.startswith('//') or '..' in Path(config[2:]).parts:
        raise RuntimeError('Expected an explicit source-root updater configuration')
    text = (source / config[2:]).read_text()
    def value(key):
        matches = re.findall(r'^\s*' + key + r'\s*=\s*"([^"\r\n]+)"', text, re.M)
        if len(matches) != 1:
            raise RuntimeError(f'Expected one explicit public updater value for {key}')
        return matches[0]
    cup = base64.b64decode(value('browser_operator_cup_key'), validate=True)
    crx = base64.b64decode(value('crx_pkhash'), validate=True)
    if len(crx) != 32 or len(cup) != 1334:
        raise RuntimeError('Unexpected public updater key shape')
    return {'config_sha256': hashlib.sha256(text.encode()).hexdigest(),
            'cup_public_spki_sha256': hashlib.sha256(cup).hexdigest(),
            'crx_public_spki_sha256': crx.hex(), 'endpoint': value('update_check_url'),
            'updater_appid': value('updater_appid'), 'browser_appid': value('browser_appid')}


def release_targets(settings):
    targets = ['chrome', 'chrome/installer/mac']
    if settings['enable_updater'] == 'true':
        targets += ['chrome/updater/mac:updater_zip',
                    'components/crx_file:crx3_build_action' if settings['target_cpu'] == '"arm64"'
                    else 'clang_arm64/crx3_build_action',
                    'third_party/devtools-frontend/src/scripts/updater/native:browser_operator_update_verify']
    return targets


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
