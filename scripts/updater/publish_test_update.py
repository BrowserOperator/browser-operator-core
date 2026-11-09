#!/usr/bin/env python3
"""Publish a verified test payload as a GitHub prerelease, without activating Omaha."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

REPOSITORY = 'BrowserOperator/browser-operator-releases'


def checked(*args):
    return subprocess.check_output(['gh', *args], text=True)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--candidate', required=True, type=Path)
    p.add_argument('--release', required=True, type=Path)
    p.add_argument('--tag', required=True)
    a = p.parse_args()
    if not re.fullmatch(r'autoupdate-test-[A-Za-z0-9._-]+', a.tag):
        p.error('Use an explicit autoupdate-test-* prerelease tag')
    release = json.loads((a.release / 'release-manifest.json').read_text())
    candidate = json.loads((a.candidate / 'update-manifest.json').read_text())
    catalog = json.loads((a.candidate / 'catalog-candidate.json').read_text())
    if release.get('update_channel') not in ('local-test', 'cloud-test') or release['notarization'] != 'accepted and stapled' or release['gatekeeper'] != 'accepted':
        p.error('Only a verified, notarized isolated test release can be published here')
    if (candidate['version'] != release['version'] or candidate['source_release_sha256'] != release['sha256'] or len(catalog['apps']) != 1):
        p.error('Candidate does not match the verified release')
    package = catalog['apps'][0]['crx']
    if Path(package['name']).name != package['name'] or not package['name'].endswith('.crx3'):
        p.error('Invalid package filename')
    artifact = a.candidate / package['name']
    with artifact.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != package['sha256'] or digest != candidate['crx_sha256'] or artifact.stat().st_size != package['size']:
        p.error('Payload digest/size mismatch')
    package['url'] = f'https://github.com/{REPOSITORY}/releases/download/{a.tag}/{artifact.name}'
    output = a.candidate / 'catalog-github.json'
    output.write_text(json.dumps(catalog, indent=2) + '\n')
    # Existing releases/assets are immutable: never clobber a tag or an asset.
    releases = json.loads(checked('release', 'list', '--repo', REPOSITORY, '--limit', '1000', '--json', 'tagName'))
    if any(item['tagName'] == a.tag for item in releases):
        p.error('Release tag already exists; use a new test tag')
    with tempfile.TemporaryDirectory(prefix='bo-release-notes-') as tmp:
        notes = Path(tmp) / 'notes.md'
        notes.write_text(f'''Isolated macOS ARM64 automatic-update qualification payload for {release['version']}.

Developer ID signed, notarized/stapled, Gatekeeper and native archive/CRX verified.
This prerelease is for update testing, not production installation. End-to-end
cloud qualification may still be pending. No Omaha catalog is activated by this
publication. The default/manual production release is unchanged.

CRX SHA256: `{digest}`
''')
        checked('release', 'create', a.tag, '--repo', REPOSITORY, '--draft', '--prerelease',
                '--latest=false', '--title', f'Automatic update test {release["version"]}', '--notes-file', str(notes))
    checked('release', 'upload', a.tag, '--repo', REPOSITORY, str(artifact), str(output),
            str(a.candidate / 'update-manifest.json'), str(a.release / 'release-manifest.json'))
    remote = json.loads(checked('api', f'repos/{REPOSITORY}/releases/tags/{a.tag}'))['assets']
    asset = next(item for item in remote if item['name'] == artifact.name)
    if asset['size'] != package['size'] or asset.get('digest') != 'sha256:' + digest:
        raise RuntimeError('GitHub asset digest/size not confirmed; release remains draft')
    checked('release', 'edit', a.tag, '--repo', REPOSITORY, '--draft=false', '--prerelease', '--latest=false')
    print(f'https://github.com/{REPOSITORY}/releases/tag/{a.tag}')
    print('Test payload published. Omaha activation remains a separate operation.')


if __name__ == '__main__':
    main()
