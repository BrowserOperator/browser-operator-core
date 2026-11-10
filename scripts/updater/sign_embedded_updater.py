"""Sign/notarize Chromium's embedded updater before sealing the browser."""

import ast
from pathlib import Path
import shutil
import subprocess
import sys


def sign_embedded_updater(build, staging, browser_app, identity, profile, log_path):
    packaging = build / 'Updater Packaging'
    config_path = packaging / 'signing/build_props_config.py'
    tree = ast.parse(config_path.read_text())
    products = [node.value.value for method in ast.walk(tree)
                if isinstance(method, ast.FunctionDef) and method.name == 'app_product'
                for node in method.body if isinstance(node, ast.Return)
                and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str)]
    if len(products) != 1 or '/' in products[0]:
        raise RuntimeError('Unknown generated updater signing configuration')
    product = products[0]
    app_name = product + '.app'
    staged_packaging = staging / packaging.name
    shutil.copytree(packaging, staged_packaging)
    for name in (app_name, product + 'Util'):
        subprocess.run(['cp', '-cR', str(build / name), str(staging / name)], check=True)
    # Gatekeeper is enforced after stapling by the containing release runner.
    unbranded = staged_packaging / 'signing/unbranded_config.py'
    unbranded.write_text(unbranded.read_text() + '''
    @property
    def run_spctl_assess(self):
        return False
''')
    # The upstream updater pipeline ignores --disable-packaging and always
    # emits HFS DMG/PKG/ZIP packages. Retain its app signing/notarization and
    # export only the signed/stapled app for embedding in the browser.
    pipeline = staged_packaging / 'signing/pipeline.py'
    text = pipeline.read_text()
    marker = '        # Package.\n'
    if text.count(marker) != 1:
        raise RuntimeError('Unknown updater signing pipeline revision')
    text = text[:text.index(marker)] + '''        commands.move_file(
            os.path.join(notary_paths.work, config.packaging_basename, config.app_dir),
            os.path.join(orig_paths.output, config.app_dir),
        )
        commands.move_file(
            os.path.join(notary_paths.work, "{.app_product}Util".format(config)),
            orig_paths.output,
        )
'''
    pipeline.write_text(text)
    output = staging / 'signed-updater'
    with log_path.open('w') as log:
        subprocess.run([
            sys.executable, str(staged_packaging / 'sign_updater.py'),
            '--input', str(staging), '--output', str(output), '--identity', identity,
            '--notarize', 'staple', '--notary-arg=--keychain-profile',
            '--notary-arg=' + profile,
        ], stdout=log, stderr=subprocess.STDOUT, check=True)
    signed = output / app_name
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(signed)], check=True)
    subprocess.run(['xcrun', 'stapler', 'validate', str(signed)], check=True)
    helpers = browser_app / 'Contents/Frameworks/Browser Operator Framework.framework/Versions/Current/Helpers'
    embedded = helpers / app_name
    if not embedded.is_dir() or embedded.is_symlink():
        raise RuntimeError('Expected embedded updater is absent from the browser build')
    shutil.rmtree(embedded)  # Only the runner's owned staging copy.
    subprocess.run(['cp', '-cR', str(signed), str(embedded)], check=True)
    return product
