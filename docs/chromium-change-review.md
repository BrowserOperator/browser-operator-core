# Browser Operator Chromium changes for review

Updated 2026-11-09. This review covers local development setup, Chromium 158/159
integration, signed release packaging, native macOS automatic updates, the
private Omaha test server and the opt-in CircleCI release path.

## Review locations

- Browser/frontend/build scripts: BrowserOperator/browser-operator-core,
  [draft PR #101](https://github.com/BrowserOperator/browser-operator-core/pull/101),
  branch `codex/browser-operator-macos-updates`. The review base preserves the
  original `fix/simplification` snapshot; that remote branch was removed.
  Current main has diverged and has not been integrated into this draft.
- Private Omaha service: https://github.com/BrowserOperator/omaha (initial commit
  contains the whole service, tests and deployment tooling).
- CircleCI integration: tysonthomas9/test-github-pipeline,
  [draft PR #7](https://github.com/tysonthomas9/test-github-pipeline/pull/7),
  branch `codex/macos-updater-release`, based on `feature/mac-sign-notarize`.

Nothing is merged by this work. Existing unrelated tracked node_modules
changes are excluded. Private keys, keychain credentials, VM state and binary
release outputs remain outside Git. The ephemeral public HTTPS endpoint and
public key configuration are generated locally and ignored by Git.

## Browser integration and resource fixes

- `scripts/chromium_dev.py`, `package.json`, panel Readme: development launcher
  for a separate profile and locally served frontend.
- `scripts/build/typescript/typescript.gni`: support newer Chromium TypeScript
  dependency contracts while retaining this frontend's legacy internal targets.
- `front_end/panels/ai_chat/BUILD.gn`, `config/gni/devtools_grd_files.gni`:
  derive resource outputs from the real action and include missing provider,
  settings, persistence, memory and image resources in the packaged app.
- `OnboardingDialog.ts`: remove unreachable statements caught by release
  typechecking. The native toolbar is implemented in the Chromium patches.

## Chromium patches and release pipeline

`patches/chromium/{158.0.8127.18,159.0.8144.0}` holds reviewed, version-specific
patches for naming, DevTools CORS, native toolbar, icons, About/manual-update
branding, remaining product display strings, and the native updater integration.
The live Chromium checkout's origin is upstream Google; custom changes are
reviewed and distributed here as patch files, not pushed to Google's upstream.
The existing build-script branding workflow remains part of checkout preparation.

- `scripts/apply_chromium_patches.py`: check a full patch series before applying.
- `scripts/sync_chromium_release.py`, `scripts/chromium_sync_git/git`: pinned
  dependency sync safeguards, including the external DevTools symlink guard.
- `config/chromium-release-mac-arm64.gn`, `scripts/build_chromium_release.py`:
  official optimized ARM64 build with PGO, full frontend typechecking, six jobs
  and a disk-space guard. ThinLTO stays off for this host's memory limit.
- `scripts/package_chromium_release.py`, `scripts/chromium_apfs_dmg.py`:
  upstream nested Developer ID signing, hardened runtime, notarization/stapling,
  APFS DMG, strict mounted signatures, Gatekeeper and functional smoke tests.
  APFS avoids the observed HFS packaging signature damage.
- `scripts/verify_chromium_{about,release}.mjs`, `scripts/chromium_cdp.mjs`:
  actual running version, About branding and bundled tool checks.

## Native update qualification

`config/chromium-autoupdate*.gn`, `config/updater/macos-local-test.gni` and
patch 08 configure an isolated native updater identity, CUP response trust and
pinned CRX package trust. Google extension/component trust roots are unchanged.
Generated launch-agent plists have quarantine removed before bootstrap.

`scripts/updater/` includes immutable build snapshots, nested updater signing,
verified ZIP/CRX packaging, actual Chromium CUP/CRX/unzip verification, a local
Omaha fixture, baseline installation, bookmark preservation, About checks and
scheduled launchd background qualification. The normal first run uses macOS
Launch Services. Cloud test configuration uses a fresh key generated on the
VM; only its public key is exported and compiled. Composition records a real
158 engine plus separately built 159 HTTPS helper without relabeling the engine.

`publish_test_update.py` publishes immutable `autoupdate-test-*` prereleases
only, checks the uploaded asset's SHA256/size, and does not activate Omaha.
The CircleCI wrapper calls these shared scripts. Publishing is opt-in and
requires signing-key paths on the runner plus GitHub authorization. It does
not automatically promote a production feed.

## Omaha service

The private `BrowserOperator/omaha` repository contains the standalone Omaha 4
service. It uses request/nonce/response-bound ML-DSA-44 CUP signatures, pinned
CRX3 payload metadata, version/platform/architecture filtering and GitHub release
URL restrictions. Its public deployment binds the Python server to loopback,
uses trusted HTTPS through nginx, limits workers/time/body/rate, and runs under
a restricted system account. The VM uses IAP SSH, no service account, an isolated
network, and automatic deletion after four hours. No local signing key was
transferred. The browser repository's service is the retained local fixture.

## Evidence and remaining work

Passed on this Mac (ARM64): full native release builds; Developer ID signing;
Apple notarization and stapled tickets; Gatekeeper; mounted-DMG smoke tests;
CUP tamper/replay and CRX wrong-key/tamper rejection; real 158-to-159 in-app
upgrade; installed launchd periodic background upgrade; actual engine 159
relaunch; original bookmark UUID; native About and AI toolbar open/close/reopen.
The standalone service's ten native/protocol tests pass. YAML parsing and shell
syntax checks pass for the CircleCI changes.

The command-line utility RPC gets a macOS System Policy write denial, while
native browser and scheduled launchd paths succeed. Qualification uses actual
installed bytes/version/signatures, not the utility's misleading exit zero.
Only disposable-controller timestamps were adjusted to simulate a due check;
no macOS privacy permissions changed.

Still pending at this review checkpoint: cloud end-to-end update, final cloud
payload notarization/publication, a remote CircleCI execution/schema check,
production rollout and updater self-update. x86/universal, Windows and Linux
are not qualified. LLM provider conversations were not tested without keys.

See `chromium-macos-autoupdate-158-to-159.md` for exact artifacts, hashes and
historical failure/recovery evidence, and `chromium-macos-release-pipeline.md`
for the original pipeline audit. Upstream 158.0.8127.18 is Beta and
159.0.8144.0 is Dev; Official Build describes build settings, not Stable channel.
