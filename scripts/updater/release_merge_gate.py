"""Require the owner's integration merge and identical product input trees."""
import json
import subprocess
import argparse
from pathlib import Path
from urllib.parse import quote


def read_api(path):
    return json.loads(subprocess.check_output(['gh', 'api', path], text=True))


def require_merged_release(policy, source_trees, reader=read_api):
    if not policy or not source_trees:
        raise RuntimeError('RELEASE HELD: missing verified publication policy or source tree')
    repo, number = policy['integration_repository'], policy['required_merged_pr']
    pr = reader(f'repos/{repo}/pulls/{number}')
    if not pr.get('merged') or pr.get('base', {}).get('ref') != policy['required_base_branch']:
        raise RuntimeError(f'RELEASE HELD: {repo}#{number} must be merged into {policy["required_base_branch"]} by the owner')
    if pr.get('merged_by', {}).get('login') not in policy.get('allowed_mergers', []):
        raise RuntimeError('RELEASE HELD: integration PR must be merged by an authorized owner')
    merged = pr.get('merge_commit_sha')
    if not merged:
        raise RuntimeError('RELEASE HELD: missing integration merge commit')
    commit = reader(f'repos/{repo}/git/commits/{merged}')
    if source_trees != {'root': commit['tree']['sha']}:
        raise RuntimeError('RELEASE HELD: merged product inputs differ from the signed candidate; rebuild and requalify')
    comparison = reader(f'repos/{repo}/compare/{merged}...{quote(policy["required_base_branch"], safe="")}')
    if comparison.get('status') not in ('identical', 'ahead'):
        raise RuntimeError('RELEASE HELD: approved integration merge is no longer on the base branch')
    return {'merged_pr': number, 'release_commit': merged, 'source_inputs_match': True}



if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads((args.release / 'release-manifest.json').read_text())
    result = require_merged_release(manifest.get('publication_policy'), manifest.get('release_source_trees'))
    print(json.dumps(result, indent=2))
