"""Require the owner's integration merge and identical product input trees."""
import json
import subprocess
import argparse
from pathlib import Path
from urllib.parse import quote


def read_api(path):
    return json.loads(subprocess.check_output(['gh', 'api', path], text=True))


def require_merged_release(policy, source_trees, reader=read_api):
    repo, number = policy['integration_repository'], policy['required_merged_pr']
    pr = reader(f'repos/{repo}/pulls/{number}')
    if not pr.get('merged') or pr.get('base', {}).get('ref') != policy['required_base_branch']:
        raise RuntimeError(f'RELEASE HELD: {repo}#{number} must be merged into {policy["required_base_branch"]} by the owner')
    branch = reader(f'repos/{repo}/branches/{quote(policy["required_base_branch"], safe="")}')
    commit = reader(f'repos/{repo}/git/commits/{branch["commit"]["sha"]}')
    tree = reader(f'repos/{repo}/git/trees/{commit["tree"]["sha"]}')
    current = {entry['path']: entry['sha'] for entry in tree['tree']}
    required = {'front_end', 'BUILD.gn', 'config', 'scripts', 'patches'}
    if set(source_trees) != required or any(current.get(path) != sha for path, sha in source_trees.items()):
        raise RuntimeError('RELEASE HELD: merged main product inputs differ from the signed candidate; rebuild and requalify')
    return {'merged_pr': number, 'release_commit': branch['commit']['sha'], 'source_inputs_match': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads((args.release / 'release-manifest.json').read_text())
    result = require_merged_release(manifest['publication_policy'], manifest['release_source_trees'])
    print(json.dumps(result, indent=2))
