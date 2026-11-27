"""A signed/notarized candidate cannot masquerade as a runtime-tested release."""
import json
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest.mock import patch

import package_chromium_release as release

class DeferredReleaseTests(unittest.TestCase):
    def test_static_verification_does_not_launch_updater_or_emit_release_manifest(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);output=root/'release';(output/'artifacts').mkdir(parents=True)
            (output/'artifacts/candidate.dmg').write_bytes(b'fixture')
            volume=root/'mounted';app=volume/'Browser Operator.app';(app/'Contents').mkdir(parents=True)
            (app/'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleShortVersionString':'158.0.8127.37','KSChannelID':'stable'}))
            (volume/'Applications').symlink_to('/Applications')
            helpers=app/'Contents/Frameworks/Browser Operator Framework.framework/Versions/Current/Helpers'
            (helpers/'BrowserOperatorUpdater.app').mkdir(parents=True)
            mounted=plistlib.dumps({'system-entities':[{'mount-point':str(volume)}]})
            settings={'target_cpu':'"universal"','enable_updater':'true','browser_operator_updater_config':'"//config/updater/macos-production.gni"'}
            provenance={'source_base_revision':'a'*40,'source_frozen_manifest_sha256':'b'*64,'browser_operator_version':'0.7.0','updater_trust':{'endpoint':'https://updates.browseroperator.io/service/update2/json'}}
            with patch.object(release,'run'),patch.object(release,'assess_gatekeeper'),patch.object(release,'validate_mounted_app'),patch.object(release.subprocess,'check_output',return_value=mounted),patch('chromium_macos_arch.verify_bundle_version'),patch('chromium_macos_arch.verify_architectures',return_value={'binary':['arm64','x86_64']}),patch.object(release,'smoke_test') as smoke,patch('updater.macos_smoke_scope.UpdaterSmokeScope') as scope:
                release.verify_release(root,output,app.name,'158.0.8127.37','BN879H59CY',settings,'node',provenance,runtime_checks=False)
                smoke.assert_not_called();scope.assert_not_called()
            self.assertFalse((output/'release-manifest.json').exists())
            manifest=json.loads((output/'candidate-manifest.json').read_text())
            self.assertEqual('pending-clean-user',manifest['runtime_qualification'])
            self.assertEqual('pending-clean-user',manifest['installed_dmg_copy_functional_tests'])
            self.assertEqual({},manifest['functional_test_architectures'])
            self.assertEqual('held-until-owner-merge',manifest['publication'])

if __name__=='__main__':unittest.main()
