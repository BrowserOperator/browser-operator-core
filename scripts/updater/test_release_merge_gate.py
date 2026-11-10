import unittest
from release_merge_gate import require_merged_release


class MergeGateTests(unittest.TestCase):
    def setUp(self):
        self.policy = {'integration_repository': 'BrowserOperator/browser-operator-core', 'required_merged_pr': 111, 'required_base_branch': 'main'}
        self.sources = {name: 'a' * 40 for name in ['front_end', 'BUILD.gn', 'config', 'scripts', 'patches']}

    def test_unmerged_pr_stops_before_any_further_api_access(self):
        calls = []
        def read(path):
            calls.append(path)
            return {'merged': False, 'base': {'ref': 'main'}}
        with self.assertRaisesRegex(RuntimeError, 'must be merged'):
            require_merged_release(self.policy, self.sources, read)
        self.assertEqual(len(calls), 1)

    def responses(self, changed=False):
        replies = iter([{'merged': True, 'base': {'ref': 'main'}}, {'commit': {'sha': 'mainsha'}},
                        {'tree': {'sha': 'treesha'}}, {'tree': [{'path': path, 'sha': 'b'*40 if changed and path == 'front_end' else sha} for path, sha in self.sources.items()]}])
        return lambda _path: next(replies)

    def test_merged_but_changed_source_is_held(self):
        with self.assertRaisesRegex(RuntimeError, 'rebuild and requalify'):
            require_merged_release(self.policy, self.sources, self.responses(changed=True))

    def test_merge_and_exact_product_inputs_are_required(self):
        result = require_merged_release(self.policy, self.sources, self.responses())
        self.assertTrue(result['source_inputs_match'])
        self.assertEqual(result['release_commit'], 'mainsha')
