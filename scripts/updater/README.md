# Native macOS updater qualification

Browser-side packaging and qualification live in this directory. The Omaha
server, protocol/native server tests and cloud deployment are maintained only
in the private https://github.com/BrowserOperator/omaha repository.
Neither normal frontend builds nor manual-release packaging require that repo.

For local update qualification, check out the reviewed server revision:

```sh
gh repo clone BrowserOperator/omaha /path/to/omaha
git -C /path/to/omaha checkout --detach a7261174014a052ed1c2bf3eb88fc5e58adefa9e
python3 scripts/updater/qualify_macos_upgrade.py \
  --omaha-src /path/to/omaha --candidate /path/to/verified-candidate \
  --openssl /opt/homebrew/bin/openssl
```

The harness checks the server revision and rejects modified tracked service
code. It launches the canonical module with local fault modes for invalid CUP
and corrupted payload rejection, then exercises the installed launchd updater.
Prepare the signed baseline and disposable profile as described in
`../../docs/chromium-macos-autoupdate-158-to-159.md`; the harness refuses an
unexpected install or updater registration. No production install is used.

Run the canonical server's protocol and actual Chromium crypto tests:

```sh
cd /path/to/omaha
CHROMIUM_BUILD=/path/to/chromium/out/Release \
OMAHA_TEST_KEYS=/private/path/to/test-keys \
python3 -m unittest discover -s tests -v
```

Cloud VM provisioning and HTTPS setup are in that repository's `deploy/`.
Private signing keys, cloud state and generated endpoint configuration are not
committed to either repository. Frozen-input inventory/build validation shared
with manual releases is in `../chromium_build_input.py`.
