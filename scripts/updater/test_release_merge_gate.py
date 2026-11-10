import unittest
from release_merge_gate import require_merged_release


class MergeGateTests(unittest.TestCase):
    def setUp(self):
        self.policy = {'integration_repository': 'BrowserOperator/browser-operator-core', 'required_merged_pr': 111, 'required_base_branch': 'main', 'allowed_mergers': ['owner']}
        self.sources = {'root': 'a' * 40}

    def test_unmerged_pr_stops_before_any_further_api_access(self):
        calls = []
        def read(path):
            calls.append(path)
            return {'merged': False, 'base': {'ref': 'main'}}
        with self.assertRaisesRegex(RuntimeError, 'must be merged'):
            require_merged_release(self.policy, self.sources, read)
        self.assertEqual(len(calls), 1)

    def responses(self, changed=False):
        replies = iter([{'merged': True, 'base': {'ref': 'main'}, 'merged_by': {'login': 'owner'}, 'merge_commit_sha': 'mainsha'},
                        {'tree': {'sha': 'b'*40 if changed else 'a'*40}}, {'status': 'ahead'}])
        return lambda _path: next(replies)

    def test_merged_but_changed_source_is_held(self):
        with self.assertRaisesRegex(RuntimeError, 'rebuild and requalify'):
            require_merged_release(self.policy, self.sources, self.responses(changed=True))

    def test_merge_and_exact_product_inputs_are_required(self):
        result = require_merged_release(self.policy, self.sources, self.responses())
        self.assertTrue(result['source_inputs_match'])
        self.assertEqual(result['release_commit'], 'mainsha')

    def test_missing_policy_is_held_without_reading_github(self):
        with self.assertRaisesRegex(RuntimeError, 'missing verified'):
            require_merged_release(None, {}, lambda _: self.fail('Unexpected API call'))

    def test_another_merger_cannot_satisfy_owner_hold(self):
        with self.assertRaisesRegex(RuntimeError, 'authorized owner'):
            require_merged_release(self.policy, self.sources, lambda _: {'merged': True, 'base': {'ref': 'main'}, 'merged_by': {'login': 'someone-else'}})
