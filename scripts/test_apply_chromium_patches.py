"""Validate ordered patch checking without writing partial source changes."""
from pathlib import Path
import subprocess
import tempfile
import unittest
from apply_chromium_patches import combined_patch


class OrderedPatchTests(unittest.TestCase):
    def inputs(self, root):
        source = root / 'source'
        source.mkdir()
        (source / 'file.txt').write_text('original\n')
        patches = []
        for number, before, after in [(1, 'original', 'intermediate'), (2, 'intermediate', 'final')]:
            path = root / f'{number}.patch'
            path.write_text(f'--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-{before}\n+{after}\n')
            patches.append(path)
        return source, patches

    def test_overlapping_series_is_checked_before_one_final_apply(self):
        with tempfile.TemporaryDirectory() as temp:
            source, patches = self.inputs(Path(temp))
            prepared = combined_patch(source, patches)
            self.assertEqual((source / 'file.txt').read_text(), 'original\n')
            subprocess.run(['git', 'apply', '-'], cwd=source, input=prepared, check=True)
            self.assertEqual((source / 'file.txt').read_text(), 'final\n')

    def test_late_failure_leaves_actual_source_unchanged(self):
        with tempfile.TemporaryDirectory() as temp:
            source, patches = self.inputs(Path(temp))
            patches[1].write_text(patches[1].read_text().replace('-intermediate', '-wrong source'))
            with self.assertRaises(subprocess.CalledProcessError):
                combined_patch(source, patches)
            self.assertEqual((source / 'file.txt').read_text(), 'original\n')
