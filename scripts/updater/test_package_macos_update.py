import os
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile

from package_macos_update import archive_app


class ArchiveTests(unittest.TestCase):
    def test_preserves_framework_links_and_executable_modes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            app = root / 'Browser Operator.app'
            (app / 'Versions/159').mkdir(parents=True)
            binary = app / 'Versions/159/program'
            binary.write_bytes(b'fixture executable')
            binary.chmod(0o755)
            (app / 'Versions/Current').symlink_to('159')
            installer = root / '.install'
            installer.write_text('#!/bin/bash\nexit 0\n')
            installer.chmod(0o755)
            archive_app(app, installer, root / 'update.zip')
            with zipfile.ZipFile(root / 'update.zip') as archive:
                link = archive.getinfo('Browser Operator.app/Versions/Current')
                self.assertTrue(stat.S_ISLNK(link.external_attr >> 16))
                self.assertEqual(archive.read(link), b'159')
                mode = archive.getinfo('Browser Operator.app/Versions/159/program').external_attr >> 16
                self.assertEqual(mode & 0o777, 0o755)
                self.assertTrue(archive.getinfo('.install').external_attr >> 16 & stat.S_IXUSR)
                self.assertNotIn('Browser Operator.app/Versions/Current/program', archive.namelist())

    def test_rejects_external_symlink(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            app = root / 'Browser Operator.app'
            app.mkdir()
            installer = root / '.install'
            installer.write_text('fixture')
            (app / 'escape').symlink_to('../.install')
            with self.assertRaises(RuntimeError):
                archive_app(app, installer, root / 'update.zip')


if __name__ == '__main__':
    unittest.main()
