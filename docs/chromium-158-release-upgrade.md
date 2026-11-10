# Chromium 158 release upgrade

Channel correction, November 8: upstream identifies 158.0.8127.18 as Beta.
The earlier Stable label in this historical build record was incorrect.
Current automatic-update work is tracked in
[the macOS 158-to-159 qualification notes](chromium-macos-autoupdate-158-to-159.md).

Target: **158.0.8127.18**, verified source tag at
`6449d9f9a6a906edff724b7b220199b3fde4615c`.

The signed shipping-DMG follow-up is tracked in
[chromium-158-distribution-release.md](chromium-158-distribution-release.md).
The local-build results and distribution audit below are historical stages;
consult that follow-up for the current shipping settings and artifact status.

The old 148 component build output was removed to recover roughly 7 GB, as
requested. Before removal, source changes, 117 untracked source/assets files,
build arguments, and logs were saved under:

`/Users/tyson/chromium/browser-operator-backups/148.0.7778.56`.

The old frontend symlink was restored to the clean stock DevTools checkout
before changing Chromium versions or running gclient. The recovery stash ID is
saved in that backup directory's `stash-revision.txt`.

## Version-specific patches

The five core patches have been ported to pristine stable 158 source files and
saved in `patches/chromium/158.0.8127.18`. All five pass `git apply --check`.
The series includes the two required toolbar PNG assets under `assets/`.
The toolbar callback now takes `BrowserWindowInterface*`, matching the updated
Chromium API. The original signing/notarization workaround is not part of these
feature patches.

```sh
python3 scripts/apply_chromium_patches.py --chromium-src /path/to/chromium/src
python3 scripts/apply_chromium_patches.py --chromium-src /path/to/chromium/src --apply
```

The script defaults to checking, refuses unknown Chromium versions, and checks
the whole series and asset conflicts before applying. It installs the toolbar
icons and refuses to overwrite different existing icons. Fresh-source check,
apply, reverse-check, asset comparison, and conflict refusal all passed.
Use the existing upstream `smart_rebrand.py`
for branding. Merge matching logo/icon assets rather than deleting new-version
theme directories with the old asset copier. Frontend integration follows the
dependency sync, so gclient never syncs across the external frontend symlink.

## Release configuration

`config/chromium-release-mac-arm64.gn` is the active release configuration:
optimized non-component browser, no debug symbols/dSYMs, bundled DevTools, and
ThinLTO disabled to bound linker memory on this 16 GB Mac. This is a local
Browser Operator release build, without Google's signing or API credentials.

## Storage-bounded dependency sync

The original tag-based gclient invocation attempted an unbounded fetch of the
source remote. It was interrupted before proceeding. Pin the already-fetched
source **hash** and use a process-local Git wrapper, because depot_tools'
`--no-history` applies to initial clones but not every existing-checkout fetch:

```sh
cd /Users/tyson/chromium
DEPOT_TOOLS_UPDATE=0 \
BROWSER_OPERATOR_REAL_GIT=/Applications/Xcode.app/Contents/Developer/usr/bin/git \
PATH=/Users/tyson/codebase/browser-operator-core/scripts/chromium_sync_git:/Users/tyson/chromium/src/third_party/depot_tools:$PATH \
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  /Users/tyson/chromium/src/third_party/depot_tools/gclient sync --no-history --shallow \
  --revision src@6449d9f9a6a906edff724b7b220199b3fde4615c --jobs 4
```

The wrapper forwards normal Git commands, adds `--depth=1` to fetches without
an explicit depth, selects exact gitlink revisions where available, and refuses
`--unshallow`. It is scoped to this command's
PATH; global Git configuration and depot_tools source are unchanged. Argument
forwarding, depth insertion, explicit-depth handling, and refusal were tested.

The older `/Users/tyson/depot_tools` vpython client cannot parse the new
`requires-python` TOML specification and caused hook exit status 2. Use the
matching depot_tools revision bundled with 158, as shown above. The subsequent
sync and hooks completed with exit status 0.

Final sync log: `/private/tmp/browser-operator-158-sync-current-tools.log`.

Eight clean JetStream/Speedometer benchmark checkouts, excluded by the small
checkout configuration, were removed after recording revisions and checking
for local changes. The cleanup inventory is in the 148 backup directory.

**Before any future gclient sync**, restore stock DevTools: the standard `src`
path is currently a symlink to Browser Operator; the synced stock 158 checkout
is preserved at `third_party/devtools-frontend/src.chromium-158-original`.
Never run gclient across the external frontend symlink.

## Release build compatibility and preflight

- Chromium 158's BiDi GN targets use `ts_deps`, `_sources`, and `_checked`,
  which the older frontend TypeScript template lacked. Added a compatibility
  layer for external consumers, preserving the frontend's legacy contract.
- Release metadata had a duplicated source list omitting ten newer AI modules.
  It now derives JavaScript resources from the actual TypeScript outputs.
- GN generation passed: 32,857 targets from 5,087 files.
- Bundled frontend preflight passed all 1,360 actions, including resource checks.
- Generated GN values verified: `is_debug=false`, `is_component_build=false`,
  `devtools_bundle=true`.

```sh
cd /Users/tyson/codebase/browser-operator-core
python3 scripts/build_chromium_release.py \
  --chromium-src /Users/tyson/chromium/src --jobs 6 --min-free-gib 5 \
  --log /private/tmp/browser-operator-158-release-build.log
```

The runner stops its Ninja process group gracefully if free space falls below
5 GiB. Tests covered low-space interruption and compiler-error propagation.
Output: `/Users/tyson/chromium/src/out/Release`.
Runner log: `/private/tmp/browser-operator-158-release-runner.log`.

## Completed local build and AI verification

Native release compilation completed successfully: **56,693 actions, exit 0**.
The source remains on branch `codex/browser-operator-158` at the pinned stable
revision above.

- App: `/Users/tyson/chromium/src/out/Release/Browser Operator.app`.
- App version: **158.0.8127.18**, ARM64, bundle ID
  `com.browseroperator.BrowserOperator`.
- Optimized, non-component build with bundled DevTools. The final
  `verify_libraries_chrome_app` action passed; executable dependencies point
  inside the app bundle or to macOS system libraries.
- App size: approximately **703 MB**; complete Release output: **8.5 GB**.
  Approximately **14 GiB** remained free after compilation.
- A temporary `caffeinate -i -w <build-runner-pid>` assertion prevented idle
  sleep during compilation and ended automatically with the runner.

Headless native validation passed using a disposable profile, loopback CDP,
and the mock test keychain. No development HTTP server or custom frontend flag
was used. The browser reported `Chrome/158.0.8127.18` and loaded
`devtools://devtools/bundled/devtools_app.html`.

The live bundled tool registry passed:

1. `execute_code`: returned the isolated test page's title.
2. `get_page_content`: returned its heading and accessible controls.
3. `take_screenshot`: returned a valid PNG.

The frontend accessibility tree contains the Browser Operator welcome screen,
AI Assistant panel, settings, model selector, and chat controls. Provider
credentials are absent, so model conversations were not tested.

Reusable verification command, after launching the compiled browser with a
disposable profile and `--remote-debugging-port=9445`:

```sh
node scripts/verify_chromium_release.mjs \
  http://127.0.0.1:9445 158.0.8127.18 \
  /private/tmp/browser-operator-158-verification
```

The script saves `report.json` and `page.png`. It inspects the live bundle's
tool registry through CDP; direct imports of development-only tool modules can
fail because their unbundled dependency graphs are not shipped in release
bundles. That initial smoke-test failure did not require a product change.

Startup log: `/private/tmp/browser-operator-158-headless.log`.
One nonblocking compatibility warning remains: the older frontend sends
`Network.clearAcceptedEncodingsOverride`, which the 158 backend no longer
implements. The tested AI tools work; custom accepted-encoding override
controls have not been validated. Quarantine-attribute and locked-display
fallback messages also appeared during headless startup.

## Desktop verification completed

On **2026-11-07 (America/Los_Angeles)**, after the user unlocked the Mac,
native desktop verification passed against the compiled **158.0.8127.18**
release app above:

- The native **AI Assistant** toolbar button opened the bundled AI panel.
- The branded welcome screen rendered correctly; **Skip** revealed the chat
  interface.
- The settings menu opened the provider settings dialog, including the API-key
  field and model controls. The dialog closed normally without saving changes.
- The main model picker opened and listed its configured choices; it was
  dismissed without changing the selection.
- **Close Chat Window** closed the panel. Clicking the native toolbar button
  again reopened it cleanly, with the chat controls rendered correctly.
- The same registered-tool smoke test passed in this visible browser:
  `execute_code`, `get_page_content`, and `take_screenshot`, exit 0.

The desktop test used an isolated profile at
`/private/tmp/browser-operator-158-desktop-20261107`, loopback CDP port **9458**,
and a mock test keychain to avoid accessing the user's keychain. It used the
bundled frontend, without a development HTTP server or custom frontend flag.

Evidence: `/private/tmp/browser-operator-158-desktop-verification-20261107/`
contains `report.json` and `page.png`. Startup log:
`/private/tmp/browser-operator-158-desktop-20261107.log`.
The release app was left open for the user in this isolated profile.

Provider credentials remain absent. **Send message** is disabled with the
expected credentials-required message; actual model conversations have not
been tested. The nonblocking protocol warning noted above remains recorded.

## Distribution readiness audit: 2026-11-07

The optimized local build and AI toolbar tests above do **not** constitute a
finished, signed distribution release. The user's About-page screenshot
exposed additional gaps that the toolbar smoke test did not cover:

- Effective GN values are `is_debug=false`, `is_component_build=false`,
  **`is_official_build=false`**, and **`dcheck_always_on=true`**. Therefore
  **Developer Build** is an accurate label. A shipping build needs the official
  optimization configuration while retaining Browser Operator branding; merely
  replacing this label would misrepresent the build.
- **`enable_updater=false`** selects
  `chrome/browser/updater/updater_no_updater.cc`. Its `CheckForUpdate` returns
  `kUpdateError` with default zero-valued codes. The macOS About-page handler
  formats that as the misleading **0 (error code 0)** message. This is a
  disabled-updater stub, not evidence of a failed browser-version download or
  an AI toolbar failure. The About page needs an honest manual-update message
  or a configured Browser Operator updater.
- Settings labels **AI in Chrome** and **You and Google** remain in upstream
  settings strings. The existing branding pass did not cover them. Chromium
  project attribution is separate from those remaining product labels.
- `codesign -dv --verbose=4` reports only **ad-hoc, linker-signed** binary
  signatures, with no team identifier or sealed bundle resources.
  `codesign --verify --deep --strict` fails with
  `code has no resources but signature indicates they must be present`.
  Full application signing has **not** been performed.
- No final DMG or PKG was produced, and the application was **not notarized**.
  The current artifact is the locally built `.app` bundle.
- A read-only identity lookup found **one valid Developer ID Application
  identity** on this Mac. No private key was used, and notarization credentials
  have not yet been verified.

Remaining distribution work: complete settings/About branding and update
behavior, rebuild with shipping optimization settings, run Chromium's nested
bundle signing pipeline with the intended Developer ID identity, create the
distribution package, and notarize/staple and validate the final artifact.
