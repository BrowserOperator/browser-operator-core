#!/usr/bin/env python3
"""Publish a verified test payload as a GitHub prerelease, without activating Omaha."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import quote

REPOSITORY = 'BrowserOperator/browser-operator-releases'


def checked(*args):
    return subprocess.check_output(['gh', *args], text=True)


def public_release_manifest(release):
    """Keep build-host paths and untracked filenames in private audit evidence."""
    fields = ('version', 'architecture', 'update_channel', 'team_id', 'dmg', 'sha256',
              'notarization', 'gatekeeper', 'mounted_app_functional_tests',
              'mounted_app_validation', 'installed_dmg_copy_functional_tests',
              'functional_test_architectures', 'native_updater_upgrade_test',
              'intel_hardware_test', 'updater_trust', 'build_settings',
              'source_base_revision', 'source_patch_sha256', 'source_frozen_manifest_sha256')
    result = {key: release[key] for key in fields if key in release}
    for key in ('native_source_state', 'frontend_source_state', 'universal_composition'):
        if key in release:
            result[key + '_sha256'] = hashlib.sha256(json.dumps(release[key], sort_keys=True).encode()).hexdigest()
    return result


def main(production=False):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--candidate', required=True, type=Path)
    p.add_argument('--release', required=True, type=Path)
    p.add_argument('--tag', required=True)
    p.add_argument('--build-input', type=Path, help='Verified frozen inputs, required for production signature checks')
    p.add_argument('--resume-draft', action='store_true', help='Resume only an unchanged draft from this candidate')
    a = p.parse_args()
    pattern = r'macos-[0-9]+(?:\.[0-9]+){3}-(?:arm64|universal)' if production else r'autoupdate-test-[A-Za-z0-9._-]+'
    if not re.fullmatch(pattern, a.tag):
        p.error('Use macos-VERSION-ARCH for production or autoupdate-test-* for qualification')
    if subprocess.run(['git', 'check-ref-format', 'refs/tags/' + a.tag],
                      capture_output=True).returncode:
        p.error('Test tag must be a valid Git reference')
    release = json.loads((a.release / 'release-manifest.json').read_text())
    candidate = json.loads((a.candidate / 'update-manifest.json').read_text())
    catalog = json.loads((a.candidate / 'catalog-candidate.json').read_text())
    if release.get('update_channel') != ('stable' if production else 'cloud-test') or release['notarization'] != 'accepted and stapled' or release['gatekeeper'] != 'accepted':
        p.error('Only a verified, notarized release from the selected channel can be published')
    if production:
        if a.tag != f'macos-{release["version"]}-{release["architecture"]}':
            p.error('Production tag must match the exact verified version and architecture')
        if (candidate.get('crx_public_key_sha256') != release.get('updater_trust', {}).get('crx_public_spki_sha256')
                or catalog.get('channel') != 'stable' or candidate.get('channel') != 'stable'
                or candidate.get('architecture') != release['architecture']):
            p.error('Production catalog/publisher trust mismatch')
        if not a.build_input:
            p.error('Production publication requires --build-input')
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from chromium_build_input import load
        frozen = load(a.build_input)
        if (frozen['version'] != release['version'] or frozen.get('updater_trust') != release['updater_trust']
                or frozen['build_settings']['target_cpu'].strip('"') != release['architecture']
                or hashlib.sha256((a.build_input / 'frozen-input.json').read_bytes()).hexdigest()
                != release.get('source_frozen_manifest_sha256')):
            p.error('Production release does not match the verified frozen inputs')
    if (candidate['version'] != release['version'] or candidate['source_release_sha256'] != release['sha256'] or len(catalog['apps']) != 1):
        p.error('Candidate does not match the verified release')
    app = catalog['apps'][0]
    if app['version'] != release['version'] or app['appid'] != 'com.browseroperator.BrowserOperator':
        p.error('Catalog application identity/version differs from the verified release')
    if production:
        architectures = ['arm64', 'x86_64'] if release['architecture'] == 'universal' else ['arm64']
        if app.get('architectures') != architectures:
            p.error('Catalog architecture coverage differs from the verified app')
    package = catalog['apps'][0]['crx']
    if Path(package['name']).name != package['name'] or not package['name'].endswith('.crx3'):
        p.error('Invalid package filename')
    artifact = a.candidate / package['name']
    with artifact.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if digest != package['sha256'] or digest != candidate['crx_sha256'] or artifact.stat().st_size != package['size']:
        p.error('Payload digest/size mismatch')
    if production:
        subprocess.run([str(a.build_input / 'browser_operator_update_verify'), 'crx', str(artifact),
                        release['updater_trust']['crx_public_spki_sha256']], check=True)
    package['url'] = f'https://github.com/{REPOSITORY}/releases/download/{a.tag}/{artifact.name}'
    output = a.candidate / 'catalog-github.json'
    output.write_text(json.dumps(catalog, indent=2) + '\n')
    public = a.candidate / 'public'
    public.mkdir(exist_ok=True)
    published_manifest = public / 'release-manifest.json'
    published_manifest.write_text(json.dumps(public_release_manifest(release), indent=2) + '\n')
    files = [artifact, output, a.candidate / 'update-manifest.json', published_manifest]
    if production:
        dmg = a.release / 'artifacts' / release['dmg']
        if dmg.parent != a.release / 'artifacts':
            p.error('Invalid production DMG filename')
        with dmg.open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != release['sha256']:
                p.error('Production DMG differs from the verified release')
        files.append(dmg)
    expected = {}
    for path in files:
        with path.open('rb') as stream:
            expected[path.name] = (path, path.stat().st_size, 'sha256:' + hashlib.file_digest(stream, 'sha256').hexdigest())
    # Draft releases do not necessarily have a Git tag yet; look them up by
    # release ID rather than the /tags endpoint. Uploaded assets are immutable.
    pages = json.loads(checked('api', f'repos/{REPOSITORY}/releases?per_page=100', '--paginate', '--slurp'))
    matches = [item for page in pages for item in page if item['tag_name'] == a.tag]
    if len(matches) > 1:
        p.error('Multiple releases have the same tag; refusing ambiguous publication')
    existing = matches[0] if matches else None
    if existing and (not a.resume_draft or not existing['draft'] or existing['prerelease'] == production):
        p.error('Release tag exists; only an unchanged matching draft can be resumed explicitly')
    if not existing:
        with tempfile.TemporaryDirectory(prefix='bo-release-notes-') as tmp:
            notes = Path(tmp) / 'notes.md'
            notes.write_text((f'''Browser Operator {release['version']} macOS {release['architecture']}.

Developer ID signed, notarized/stapled and Gatekeeper verified. Includes the
production auto-updater. Publishing assets does not activate an Omaha update;
the next-version catalog requires separate native upgrade qualification and promotion.

CRX SHA256: `{digest}`
''' if production else f'''Isolated macOS ARM64 automatic-update qualification payload for {release['version']}.

Developer ID signed, notarized/stapled, Gatekeeper and native archive/CRX verified.
This prerelease is for update testing, not production installation. End-to-end
cloud qualification may still be pending. No Omaha catalog is activated by this
publication. The default/manual production release is unchanged.

CRX SHA256: `{digest}`
'''))
            flags = [] if production else ['--prerelease']
            checked('release', 'create', a.tag, '--repo', REPOSITORY, '--draft', *flags,
                    '--latest=false', '--title', f'Browser Operator {release["version"]} {release["architecture"]}'
                    if production else f'Automatic update test {release["version"]}', '--notes-file', str(notes))
        pages = json.loads(checked('api', f'repos/{REPOSITORY}/releases?per_page=100', '--paginate', '--slurp'))
        matches = [item for page in pages for item in page if item['tag_name'] == a.tag]
        if len(matches) != 1 or not matches[0]['draft'] or matches[0]['prerelease'] == production:
            p.error('Release changed during creation; refusing ambiguous publication')
        existing = matches[0]
    release_api = f'repos/{REPOSITORY}/releases/{existing["id"]}'
    def draft_assets():
        snapshot = json.loads(checked('api', release_api))
        if (snapshot.get('tag_name') != a.tag or not snapshot.get('draft')
                or snapshot.get('prerelease') == production):
            raise RuntimeError('Selected release is no longer the expected draft')
        return snapshot['assets']
    remote = draft_assets()
    for asset in remote:
        if asset['name'] not in expected:
            raise RuntimeError('Unexpected draft asset; refusing to replace or remove it')
        _, size, sha = expected[asset['name']]
        if asset['size'] != size or asset.get('digest') != sha:
            raise RuntimeError('Draft asset changed; refusing to clobber it')
    uploaded = {asset['name'] for asset in remote}
    for name, (path, _, _) in expected.items():
        if name not in uploaded:
            checked('api', '--method', 'POST',
                    f'https://uploads.github.com/repos/{REPOSITORY}/releases/{existing["id"]}/assets?name={quote(name, safe="")}',
                    '--input', str(path), '-H', 'Content-Type: application/octet-stream')
    remote = draft_assets()
    if len(remote) != len(expected) or {asset['name'] for asset in remote} != set(expected):
        raise RuntimeError('Incomplete remote assets; release remains draft')
    for asset in remote:
        _, size, sha = expected[asset['name']]
        if asset['size'] != size or asset.get('digest') != sha:
            raise RuntimeError('GitHub asset digest/size not confirmed; release remains draft')
    checked('api', '--method', 'PATCH', f'repos/{REPOSITORY}/releases/{existing["id"]}',
            '-F', 'draft=false', '-F', 'prerelease=false' if production else 'prerelease=true',
            '-f', 'make_latest=false')
    print(f'https://github.com/{REPOSITORY}/releases/tag/{a.tag}')
    print('Payload published. Omaha activation remains a separate operation.')


if __name__ == '__main__':
    main()
