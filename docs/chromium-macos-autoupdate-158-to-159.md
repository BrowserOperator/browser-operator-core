# macOS 158 to 159 automatic-update qualification

Current checkpoint (2026-11-09): signed/notarized ARM64 158 and genuine 159
both passed local native update qualification. The normal Launch Services
in-app update PASSED, and the installed launchd periodic background update
PASSED. Actual relaunched engine 159.0.8144.0, original bookmark UUID, strict
signatures, notarization tickets, Gatekeeper and native About/AI toolbar tests
all passed. No privacy/App Management permissions changed. Report:
/Users/tyson/chromium/updater-test/normal-upgrade-qualification-report.json.

The command-line UpdaterUtil RPC still gets macOS System Policy rsync denial
74103/12. This does not reproduce from the browser or the updater's scheduled
launchd job. The scheduled test reset only last_checked/last_started in the
idle disposable controller to simulate a due check, then kickstarted its own
wake job. Do not use utility exit 0 as proof of update success. The test script
now exercises the actual scheduled path. Details and failed evidence below.

Cloud 158-to-159 scheduled native update qualification PASSED on an authorized e2-micro in
browseroperator-1746729957294, billed to the explicitly selected account ending
B70C99. The VM has IAP-only SSH, no service account, trusted HTTPS, and automatic
deletion after four hours. A separate CUP private key was generated ON the VM;
only its public key is exported for native compilation. The local CUP key was
not transferred (automatic approval review rejected that export). Cloud key
public SHA256: ef863a8811e5d67c187a08c02d1a65c780df6e5ba6b0457fabc7bc0543639909.
Official clients require a compiled HTTPS endpoint; developer remote URL
overrides are intentionally not available and were not enabled.

Private service repository: https://github.com/BrowserOperator/omaha. The user
also authorized pushing browser and CircleCI work to their existing remotes.
The signed cloud payload was published as a GitHub prerelease and all four
uploaded asset hashes/sizes were verified. The native scheduled updater fetched
173,996,709 bytes directly from GitHub, verified CUP/CRX, installed genuine 159,
retained the bookmark, and passed strict signatures/ticket/Gatekeeper. About
returned up to date. Cloud report:
/Users/tyson/chromium/updater-test/cloud-158-to-159-qualification/qualification-report.json.
Test release:
https://github.com/BrowserOperator/browser-operator-releases/releases/tag/autoupdate-test-159.0.8144.0-macos-arm64-20261109.
The VM is temporary and automatically deletes after four hours; this endpoint
and key are not a production feed. Current draft reviews:
https://github.com/BrowserOperator/browser-operator-core/pull/101 and
https://github.com/tysonthomas9/test-github-pipeline/pull/7. Never publish loopback builds as production releases. Only ARM64 is
qualified; x86, universal, Windows, Linux, updater self-update and production
rollout remain separate work. The original /Applications app is unchanged.

Historical checkpoints below preserve earlier failures and recovery evidence;
they are superseded by this checkpoint when they describe current status.

## Version correction and genuine source

The upstream version list currently identifies 158.0.8127.18 as Beta, not Stable;
the earlier stable label in historical upgrade notes was incorrect. Official
optimization/signing status is separate from upstream release channel.

Baseline source: 158.0.8127.18 at
6449d9f9a6a906edff724b7b220199b3fde4615c. Target is genuine Dev source
159.0.8144.0 at f19f8ee8a6b566fbd0cea6bdf05e284712cba9b9, fetched as a shallow
local tag and verified against Google's release metadata. Do not relabel a
158 binary as 159. The installed /Applications app and personal profile are
outside the test installation.

## Implemented foundation

- config/chromium-autoupdate-mac-arm64.gn enables updater and notifications.
- config/updater/macos-local-test.gni contains PUBLIC trust keys and a loopback
  endpoint. The updater uses its own BrowserOperatorUpdateTest identity and
  data/launchd namespace. Production/manual release defaults stay unchanged.
- Version-specific patch 08 adds per-configurator CUP trust keys; Google's
  component/extension updater trust roots are unchanged. Browser Operator CRX
  archives require its pinned key rather than Google's publisher proof.
- Current Chromium CUP uses ML-DSA-44, not the older ECDSA scheme. Private local
  test keys are outside the source repos at
  /Users/tyson/chromium/browser-operator-updater-private/test-keys (0700, key
  files 0600). Never upload or commit them. Production key custody/rotation and
  public HTTPS service deployment remain separate work.
- scripts/updater/omaha_service.py implements loopback Omaha 4 responses,
  nonce/request/response-bound CUP signatures, local verified CRX downloads,
  and explicit invalid-CUP/corrupt-download test modes. It offers no update
  to mismatched OS/architecture, unknown apps, same or newer versions.
- scripts/updater/native builds a verifier using Chromium's actual CUP and CRX
  implementations. All nine HTTP/protocol/native crypto tests PASSED, including
  tampering, wrong pinned CRX key, and CUP replay rejection. Log:
  /private/tmp/browser-operator-updater-crypto-tests.log.
- The updater-enabled 158 browser and updater/signing/CRX/native verification
  tools compiled successfully. Build log:
  /private/tmp/browser-operator-158-updater-build.log; runner:
  /private/tmp/browser-operator-158-updater-runner.log.
- scripts/updater/sign_embedded_updater.py preserves upstream nested updater
  signing/notarization, exports the stapled updater without its legacy HFS/PKG
  packaging, and embeds it before the browser is signed. Browser DMGs use the
  existing verified APFS adapter. Test artifacts have an updater-test suffix.
- The embedded updater AND containing 158 app were accepted by Apple and
  stapled. Main app request: e58e8ceb-fa08-4fab-8d33-fc8709ad946d. The DMG's
  subsequent submission failed because notarytool suddenly reported the
  existing tthoma9 credential profile missing. User has been asked to unlock
  their login keychain/restore the profile; do not ask for secrets in chat.
  Preserve the signed DMG in the signing-attempt directory for resubmission.

## Current processes and paths

The loopback service runs on 127.0.0.1:18158, unified-exec session 41119 (verify its PID before stopping it).
It reads /Users/tyson/chromium/updater-test/catalog.json, currently EMPTY
(no updates), with artifacts under that directory's artifacts subdirectory.
Log: /private/tmp/browser-operator-omaha-test-service.log.

Baseline test package root:
/Users/tyson/chromium/releases/158.0.8127.18-arm64-updater-test
Packaging log: /private/tmp/browser-operator-158-updater-package.log.

Test app destination:
/Users/tyson/chromium/updater-test/install/Browser Operator.app
Its profile must be disposable and remain separate from the user's profile.

## Verified baseline and scheduling fix

The separate 158 test app passed a real CUP-signed native About check:
`baseline-verification/native-updater-report.json` reports `updated`,
“Browser Operator is up to date”, and Official Build. Bundled tools also passed.
This proves the native no-update path, not a completed upgrade.

The first installation's background launch agent failed. Unified macOS logs
identified quarantine on its generated plist. Removing quarantine from ONLY
the owned test plist allowed bootstrap to succeed, confirming the cause.
Patch 08 now calls the existing RemoveQuarantineAttributes helper on the
updater's generated launch item before bootstrap. That correction compiled.
A fresh signed installation must still prove scheduling without manual repair.
The first notarized test app predates this fix and is diagnostic only.

Both version-specific patch 08 files include the correction. All eight 159
patches passed application and reverse checking on a fresh partial 159 tree;
report: /private/tmp/browser-operator-159-patch-preflight.json.

Full 158 source recovery inventory (tracked diff, untracked source, theme
assets, dependency revisions, gclient configuration) is preserved at:
/Users/tyson/chromium/browser-operator-backups/158-updater-before-159.
Do not port old generated sample_credits.html onto 159.

## Next required work

1. COMPLETED: preserved the corrected 158 signing input at
   /Users/tyson/chromium/updater-test/158-frozen-input (428 hashed inputs, 382 MiB),
   using scripts/updater/frozen_input.py.
   It hashes files and records source/config provenance, allowing native output
   to be reused without confusing the 158 package with the later source version.
   Frozen-input tamper rejection passed. GN args inspection rewrites gn_logs.txt;
   refresh the native targets after capturing settings before freezing.
2. After credentials are restored, sign/notarize the corrected 158 snapshot into
   a NEW output directory. Do not ship the first diagnostic test DMG as the
   corrected build or claim its missing DMG ticket has passed.
3. COMPLETED: restored stock DevTools before pinned 159 sync; all dependency
   sync/hooks passed. Recovery stash: 61c5b67897c26181511762a5b791658d4ab275ba.
   Current branch codex/browser-operator-159-autoupdate, source f19f8ee8...;
   stock 159 DevTools e1df1f10d345d52b88827564aa71ec3ea8462151 is preserved as
   src.chromium-159-original and the external frontend link is restored.
   scripts/sync_chromium_release.py adds shallow pinned sync and a disk guard.
   Sync log /private/tmp/browser-operator-159-sync.log, exit 0.
4. COMPLETED: all 8 reviewed 159 patches applied; smart branding passed;
   restored 67 inventoried theme assets and com.browseroperator.BrowserOperator
   bundle identity. Genuine 159 optimized ARM64 compilation is RUNNING:
   /private/tmp/browser-operator-159-updater-build.log, runner
   /private/tmp/browser-operator-159-updater-runner.log, exec session 79029.
   It reuses out/Release, 6 jobs, 5 GiB free-space guard. Check live process/log
   before resuming, never run a second Ninja in this output directory.
5. Build/sign/notarize genuine 159. Produce its update ZIP with the upstream
   generated browser .install script, sign CRX3 with the test RSA key and verify
   with the native verifier. Publish only to the local test catalog initially.
6. Real upgrade tests must prove signed check/download/install, relaunch into
   actual 159, preserved isolated profile/bookmarks, valid final signatures,
   and no change to /Applications. Reject tampered response and payload and
   prove the baseline remains usable. Capture native About/AI toolbar tests.
7. Record results and wire qualified artifact publication into CircleCI. A
   genuine upgrade, public server, GitHub publication and cross-platform
   qualification have not been completed; never imply otherwise.

## Additional qualification tools

scripts/updater/profile_sentinel.mjs creates/checks a bookmark through the
optimized Bookmarks WebUI bundle. Seed passed on the disposable 158 profile;
report updater-test/profile-seed-verification/profile-sentinel.json. Bookmark
UUID ad12f6ed-eb20-52e8-ab9a-52c2549b9721 must survive the real update.
probe_macos_baseline.py supports --version, --status, --stage and
--profile-sentinel seed/check for baseline and post-upgrade verification.

scripts/updater/package_macos_update.py requires a verified notarized local-test
release, creates a symlink/mode-preserving ZIP, uses Chromium's actual unzip
implementation, rechecks app signatures/ticket/Gatekeeper, signs CRX3 and checks
the pinned key. It writes a candidate catalog; never activates or publishes it.
Two archive tests passed; actual 159 packaging/round-trip is still pending.
The Omaha crx3 operation path is Browser Operator.app (NOT .install): Chromium
InstallFromApp invokes the sibling .install script with the required arguments.

Build runner now captures shipping settings before Ninja. Inspecting GN after
Ninja rewrites gn_logs.txt and makes license resources stale. Packaging reads
that captured metadata with source-revision/args checks, then requires current
native targets. The in-flight 159 runner started before this runner improvement;
for this build, capture settings and refresh native targets before freezing.

The existing local CircleCI mac-release-shipping.sh remains the manual-update
shipping path; it has NOT run the new upgrade qualification or published update
packages. No production updater endpoint/trust keys or public feed is deployed.

## Real native invalid-CUP test: passed

The test service returned deliberately invalid CUP proofs to the notarized 158
baseline. The actual About/native updater returned failed (-10000), as expected.
Report: updater-test/invalid-cup-verification/native-updater-report.json.
The catalog remained empty, and no application update was installed.

The first bookmark restart check exposed a TEST HARNESS issue: SIGTERM exited
before the deferred bookmark save. The probe now requests CDP Browser.close for
graceful shutdown. Reseeding and cold-relaunch checking passed, including a
healthy native About update check after the fault was removed. Report:
updater-test/recovery-after-invalid-cup/profile-sentinel.json. Its bookmark UUID
matches invalid-cup-verification/profile-sentinel.json. Both clear and encrypted
bookmark files now exist in the disposable profile. This is baseline recovery
validation, not yet a 158-to-159 preservation result.

The isolated updater registration was checked explicitly: browser ecp is
/Users/tyson/chromium/updater-test/install/Browser Operator.app, pv 158.0.8127.18.
Recheck that exact ecp before activating the 159 candidate; mounted-DMG smoke
tests can otherwise change the updater registration to a temporary volume.
The healthy service is running again; catalog still empty.

Current continuation checkpoint: 159 Ninja exceeded 15,000 of approximately
56,500 actions with no compiler errors observed; approximately 15 GiB free.
The notarization profile tthoma9 remains missing on read-only checks. There is
one pending user request to restore/unlock it; do not request any credentials
in chat. Do not mark signing, fresh launch-agent installation, corrupt-download
rejection or the real 159 upgrade complete until their evidence exists.

## Background-priority native check: passed

Created a diagnostic-only copy of the 158 UpdaterUtil under updater-test/tools,
Developer ID signed it with the same team and hardened runtime, and verified its
signature. This tool has NOT been notarized as a distribution artifact.
--list-apps confirmed only the owned test updater and Browser Operator 158.
--list-update --background --product=com.browseroperator.browseroperator --json
performed a real signed no-update round trip, exit 0. Report:
updater-test/tools/background-check.json. No new version is offered yet.
This proves the background-priority RPC/check path, not a natural timer-triggered
upgrade. Fresh installation scheduling still needs the corrected signed helper.

Code signing succeeded, confirming the signing identity is usable. Notarytool
still cannot locate tthoma9; the user was given a more specific request to restore
that credential profile locally with notarytool store-credentials (no secrets in
chat). Compiling proceeds independently.

## Snapshot and signing commands for continuation

After the native build completes, the canonical runner writes verified shipping
settings before Ninja; packaging also hashes all imported GN config inputs to
reject stale settings. This first in-flight 159 run predates that improvement:
rerun the canonical build command once after completion to capture settings and
finish any generated-resource refresh, then freeze without invoking GN again.

    python3 scripts/updater/frozen_input.py --chromium-src /Users/tyson/chromium/src --output /Users/tyson/chromium/updater-test/159-frozen-input

After tthoma9 authentication is restored, corrected 158 can be signed while 159
compiles, independently of live native output:

    python3 scripts/package_chromium_release.py --chromium-src /Users/tyson/chromium/src --frozen-input /Users/tyson/chromium/updater-test/158-frozen-input --updater-enabled --output /Users/tyson/chromium/releases/158.0.8127.18-arm64-updater-fixed

The latest read-only notarization retry still reports missing profile. Code
signing remains functional. Never reuse the old diagnostic package as proof of
the corrected first-install scheduling behavior.

The production /Applications app was rechecked and its pre-test signature,
executable hash and Info.plist hash recorded in updater-test/production-app-before.json.
It is still 158.0.8127.18, Developer ID team BN879H59CY, with strict signatures
valid. Compare this evidence after the actual test. No personal profile was read.
The background --update RPC with an empty catalog also returned success/no-update;
log updater-test/tools/background-update-nooffer.log.

## Production follow-up: updater self-updates

Chromium's EnsureUpdater returns once the browser is registered; it does not
replace an existing updater merely because a newer helper is embedded in a new
browser bundle. Production publication must therefore also serve signed updater
self-update payloads for its separate updater app ID. The current empty/local
browser-only candidate catalog does NOT qualify updater self-updates. The macOS
prototype's 158 updater can perform the requested browser 158-to-159 test, but
never treat that alone as complete production update infrastructure. Retain the
upstream self-update path rather than silently leaving the updater stale.

Source reference: chrome/browser/updater/browser_updater_client_util_mac.mm,
EnsureUpdater/IsBrowserRegistered branch. Recheck the isolated browser ecp after
any mounted-DMG smoke test before enabling a candidate. All test commands use
user scope; never pass --system to the test utility.

## Credentials restored; corrected baseline packaging resumed

The user restored tthoma9 and confirmed it. Read-only notarytool authentication
passed. Corrected 158 packaging is running independently of the 159 native build:
exec session 37820; /private/tmp/browser-operator-158-updater-fixed-package.log;
output /Users/tyson/chromium/releases/158.0.8127.18-arm64-updater-fixed.
Its corrected helper was already accepted/stapled. Containing app submission
6e4cf9c8-bc94-4a8d-98fa-23f1742c0afb is pending at this checkpoint.
Do not treat earlier missing-profile notes as the current blocker.

After the corrected package passes final mounted validation, preserve old test
controller logs/data, uninstall ONLY the custom test updater, and replace ONLY
updater-test/install/Browser Operator.app with the corrected signed baseline.
Keep the same disposable profile/bookmark. Prove fresh first-install launchd
bootstrap succeeds with NO manual xattr repair, and installed helper CDHash
matches the newly notarized embedded helper, before offering any 159 candidate.

## Corrected 158 baseline: fully packaged and fresh install passed

All corrected 158 signing/notarization/mounted smoke checks passed. Final DMG:
releases/158.0.8127.18-arm64-updater-fixed/artifacts/BrowserOperator-158.0.8127.18-arm64-updater-test.dmg
SHA256 d661942475f7f074e5f5cad8f8db1dacde44ca4a39b80aa22f132e0ecc2adbd8.
DMG Apple request 3f53cdcd-ba5c-4a18-b6ce-bec87626d86f; accepted/stapled.
release-manifest.json records source 158, official settings, Gatekeeper and mounted
functional tests passed, local-test channel, real-upgrade status still pending.

The first final verifier assumed all apps have nonempty entitlements; the helper
legitimately has none. Fixed empty output handling while retaining strict parsing
for malformed nonempty output and rejection of get-task-allow. Resumed with
--verify-existing (no rebuild, re-sign, or re-upload), exit 0.

scripts/updater/install_macos_test_baseline.py preserved the OLD diagnostic app
and test controller under updater-test/before-corrected-baseline, natively
uninstalled ONLY the owned test updater, installed the corrected DMG app into
updater-test/install, and launched it with the SAME disposable profile.
Fresh native About check passed; launchctl confirmed the wake job bootstrapped
without manual xattr repair. First bootstrap evidence was saved BEFORE resume
checks: corrected-baseline-verification/first-bootstrap-launch-agent.txt.
The plist has com.apple.provenance only, no quarantine.

The new script needed macOS xattr CLI inspection (Python on this Mac has no
os.listxattr) and resumed-variable scoping corrections. --verify-installed then
passed, without resetting or repairing anything. Final report:
updater-test/fresh-baseline-install.json. Installed helper CDHash matches the
corrected embedded helper: 317bcdb468840c033b3a063bd5962b0be3279a56.
Browser registration ecp remains updater-test/install/Browser Operator.app,
pv 158.0.8127.18. The original test bookmark UUID ad12f6ed-eb20-52e8-ab9a-52c2549b9721
survived the fresh application/controller installation and native restart checks.

159 compilation remains running in session 79029, exceeding 36,000 actions at
this checkpoint, no reported compiler failures; approximately 13 GiB free.

## 159 native build complete; desktop unlock pending

159 full native compilation completed successfully (56,237 actions), followed by
the updated canonical runner's settings capture/resource refresh (exit 0).
Frozen signing input: updater-test/159-frozen-input, 420 hash-verified entries.
Its framework contains ONLY 159.0.8144.0 and Current -> 159.0.8144.0; no stale
158 framework tree remains. All nine tests passed against the actual new 159
CUP/CRX verifier; log /private/tmp/browser-operator-159-updater-crypto-tests.log.
Both archive fixture tests passed too.

Attempted 159 packaging from the frozen input into
releases/159.0.8144.0-arm64-updater-test. Authentication preflight failed with
missing-profile message BEFORE output/signing started. The output directory
does not exist, so this exact command can be retried without overwriting anything.
Read-only ioreg confirmed CGSSessionScreenIsLocked=Yes. Login keychain remains
no-timeout; explicit login-keychain lookup has the same notarytool error. The
user was asked to unlock Mac/login Keychain; RETRY existing profile first. Do
not assume it was deleted or ask for credentials in chat. Mac UI testing also
needs the unlocked desktop. Temporarily keeping the display awake during the
short final signing/UI test window avoids repeated idle-lock interruptions.

Native ZIP qualification completed while unlock was pending:
updater-test/native-zip-roundtrip/report.json. The real Chromium 159 extractor
restored the corrected signed 158 app with strict signatures valid, stapled
ticket valid and Gatekeeper accepted. No installer was executed and the test
registration was unchanged. This validates archive mechanics, not a 159 upgrade.

Final pre-handoff state: native 159 full/finalize builds and 9 crypto/protocol
checks passed, 2 archive fixture checks passed, 159 snapshot preserved. Corrected
158 DMG fully verified and freshly installed, wake agent and profile proven.
Mac still locked on repeated ioreg checks; 159 packaging did NOT start because
notarytool could not access tthoma9. User unlock request is pending. Retry the
same 159 package command after unlock; output directory is absent. Start a
short-lived display-awake assertion during final packaging/UI work so the Mac
does not idle-lock again. Keep all tests in the owned namespace and compare
production-app-before.json at completion. Local service session 41119 remains
healthy with an empty catalog. No CI run or GitHub publication was performed.

## Normal macOS first-run resolved local installation denial

The first automated qualification attempt used a platform filter that missed
Chromium's native os.platform value "Mac OS X". Added this alias and regression
coverage; all TEN native/protocol/HTTP tests passed. Second attempt logs are in
updater-test/local-upgrade-qualification-2. Invalid CUP and corrupted payload
were both rejected with application bytes/bookmark unchanged. The valid native
background RPC found/downloaded/verified/unpacked 159, then failed at rsync mkdir
with System Policy deny(1) file-write-create. Utility exit 0 only means RPC
completion; its app-specific error was 74103/12. Never rely on exit 0 alone.

The System Settings CUA inspection stalled and was interrupted; no settings
were changed. User confirmed App Management entries were not enabled. Preserve
that state. Corrected the test flow: backed up/uninstalled ONLY the test updater,
launched the signed 158 app via normal Launch Services with its existing test
profile, and opened native About. Normal first-run registration/check passed.
Then offered the authenticated 159 candidate: native UI progressed updating ->
nearly_updated; app on disk became 159. Code signatures/stapled ticket/Gatekeeper
passed. Normal relaunch produced actual Chrome/159.0.8144.0; original bookmark
identity, bundled tools, and native About updated status all passed.

CUA runtime reset fixed the stalled UI connector. Actual 159 desktop checks:
About Official Build/ARM64 and up-to-date status, AI toolbar open, onboarding
Skip, panel Close Chat Window, toolbar reopen and toggle-close all PASSED.
Evidence: updater-test/159-desktop-verification/{desktop-report.json,about-159.png,
ai-toolbar-open.png,ai-toolbar-closed.png}. Provider conversations untested without
credentials. CUA completion summary was recorded. The 159 test GUI remains open;
endpoint in updater-test/normal-launch-159.json. Only that disposable GUI may be
closed for further tests. The production app is unchanged.

probe_macos_baseline.py now supports --launch-via-services; first-run baseline
installer uses it. The normal first-run launch context matters on this Mac;
do not use a broad privacy permission change to mask a harness issue.

Cloud authorization: account ending B70C99 selected; project billing enabled.
provision_gcp_test_vm.py targets one e2-micro, Debian 13, 10 GiB standard disk,
separate test VPC/subnet, web ports 80/443, IAP-only SSH, OS Login, no VM service
account, and automatic DELETE after 4 hours. Current provisioning exec 45813;
log /private/tmp/browser-operator-gcp-provision.log; state will be
updater-test/cloud/vm-state.json. Full cloud test awaits deployment/HTTPS and
native client configuration. Official updater constants_prod does NOT load
developer overrides.json; do not weaken its localhost-only test override guard.
For cloud, use a separately built HTTPS updater configuration (same test keys),
not certificate bypasses or disabled CUP. Need GitHub release hosting as selected.

## Completed real cloud qualification (2026-11-09)

The private Omaha service at commit 104ed61 was deployed behind nginx with a
trusted IP certificate. Actual Chromium CUP validation passed through HTTPS
(including a 4,907-byte proof header). A separate VM-generated CUP key was
compiled into the native HTTPS updater; local package-signing CRX keys stayed
on the Mac. Native official updater developer URL guards were not weakened.

Both HTTPS test DMGs were independently signed/notarized/stapled and passed
mounted functional, signature and Gatekeeper tests:

- Baseline 158 DMG SHA256:
  e7a73526e29e94c453632039cfd7e176769f587b5d8d436d25f78ea7f259c01c.
  This is a genuine frozen 158 engine with the separately built 159 HTTPS helper;
  its composition manifest records both build origins without relabeling 158.
- Target 159 DMG SHA256:
  d3e231ade2e06fd8fec39900e504670e2afb39feea3f9ff5426747f4266fc999.
- Cloud update CRX SHA256:
  6b49d4b9dce7eeab06d45a9ee660c7b272ca9c8f771651b681748c39f9d9e3dc.
  Download size 173996709 bytes; native download metrics recorded success in
  9078 ms, pinned CRX verification passed, rsyncs completed, and native 159
  relaunch retained bookmark UUID ad12f6ed-eb20-52e8-ab9a-52c2549b9721.

The fresh 158 setup used normal Launch Services and installed helper CDHash
62b171343bf083a0b40aab2e227515d665667257 with a healthy wake launch agent. With
the cloud feed activated, the native periodic launchd job updated 158 to 159;
the service observed both the 158 offer and the subsequent 159 noupdate check.
Strict signatures, Apple's ticket and Gatekeeper passed after installation.
The original /Applications app executable and Info.plist hashes were rechecked
unchanged. No personal profile or macOS privacy settings changed.

The actual GitHub publishing run found that draft releases may not yet have a
resolvable tag. The script now retrieves the draft by release ID, resumes only
explicit unchanged drafts, refuses to clobber assets, and verifies every asset's
remote SHA256/size before publishing a prerelease. This recovery path PASSED
against GitHub. Publication and cloud catalog activation remained separate.

Local evidence: cloud-158-to-159-qualification (before/after, cloud service log,
periodic native updater log and report), cloud-baseline-verification, and
cloud-post-upgrade-verification, all under /Users/tyson/chromium/updater-test.
Production promotion, updater self-update, remote CircleCI execution and other
architectures/platforms remain unqualified. Review guide:
docs/chromium-change-review.md.
