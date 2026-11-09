"""Load the pinned private Omaha service for optional local qualification."""

import importlib.util
from pathlib import Path
import subprocess

# Server implementation, protocol/native tests, and deployment live here:
# https://github.com/BrowserOperator/omaha
OMAHA_REVISION = 'a7261174014a052ed1c2bf3eb88fc5e58adefa9e'


def load_service(source):
    source = Path(source).resolve()
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()
    if revision != OMAHA_REVISION:
        raise RuntimeError(f'Checkout BrowserOperator/omaha at {OMAHA_REVISION} before qualification')
    subprocess.run(['git', 'diff', '--quiet', 'HEAD', '--', 'omaha'], cwd=source, check=True)
    spec = importlib.util.spec_from_file_location('browser_operator_omaha', source / 'omaha/service.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
