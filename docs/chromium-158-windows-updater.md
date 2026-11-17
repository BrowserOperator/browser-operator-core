# Windows 158 internal updater candidate

This candidate is an **unsigned internal x64 test build**, held from release until
owner review and merge. It does not change the frozen macOS 0.7.0 R2 inputs.
The branch stacks on the Windows patch-path correction (PR112).

The build must set `enable_updater=true` and
`browser_operator_updater_config="//third_party/devtools-frontend/src/config/updater/windows-production.gni"`.
The configuration reuses only the public production CUP and CRX verification
roots. It never contains a private signing key or credential.

`11-windows-native-updater.patch` supplies a separate Browser Operator Windows
install mode, registry tree, stable app IDs, legacy COM identities, mutexes,
and service identities. The values in `windows-identities.json` are permanent;
do not regenerate them between versions. GUIDs use UUID5 names under
`browseroperator.io/windows/stable/`. Browser data is separate from Chromium and
Chrome. Registry integration uses `Software\BrowserOperator\Update`, with the
32-bit registry view expected by the native updater. Service IDL substitutions
use Chromium's dynamic-GUID support rather than changing prebuilt MIDL outputs.

The mini-installer includes UpdaterSetup.exe in the browser version directory.
After a successful browser installation writes its Clients registration, setup
installs the product's updater if it is absent. Its first activation imports
that registration. An updater installation failure is an installation failure,
not a silent success. Subsequent browser updates reuse the installed updater.
The Windows About page uses the native COM updater and the bundled AI panel's
fixed update action opens that page. Existing privileged URL restrictions remain.

Qualification runs in a disposable, non-admin Windows account. Run
`scripts/verify_chromium_windows_release.ps1` with ChromiumSource, Installer and
Artifacts arguments. It executes the installer, checks the branded installed
path and both native registrations, launches the installed browser with a
separate profile, exercises real AI tools and the native update action, checks
privileged-URL blocking, and waits for the native production HTTPS/CUP check.
It records the real OS and does not claim an upgrade to 159 from a no-update
response. The initial worker is Windows Server 2022; Windows 10/11 user-machine
coverage and signed public distribution remain separate qualifications.

The production catalog stays unchanged and empty while the release is held.
The cloud service currently offers macOS payloads only. A Windows 159 offer
requires separate Windows installer/payload publication support and a real
158-to-159 upgrade test before promotion. No test should manufacture an update
result or disable CUP, CRX verification, or browser sandboxing.

Windows installer qualification found that the original BrowserOperatorHTM/PDF
prefixes exceeded Windows' 39-character ProgId limit once Chromium appended the
27-character per-user suffix. Use BrowserOpHTM and BrowserOpPDF (12 + 27 = 39);
compile-time assertions retain this constraint. Visible product names and all
browser/updater GUIDs remain unchanged. This repairs actual setup failure
0x80000003 during browser registration, rather than suppressing the check.

A fresh non-interactive Windows user profile also exposed an upstream setup
assumption: RegisterUserRunAtStartup wrote a value without first creating
HKCU\Software\Microsoft\Windows\CurrentVersion\Run. The native log recorded
ERROR_FILE_NOT_FOUND and updater exit75044, rolling back the updater. Add a
CreateRegKey work item before the value, retaining normal transaction rollback;
do not pre-create the key in the qualification to hide this installer defect.

Qualification must uninstall only the installation whose stored SID/path marker
matches this test before reinstalling another candidate with the same engine
version. Chromium same-version repair retained the original UpdaterSetup.exe
on disk, while both packaging layers correctly contained the new updater. Hash
reports proved built/embedded/bundled equality and installed-wrapper mismatch.
The test now performs a fresh owned install, then compares both installed updater
binaries with the built payload before functional tests. Unknown installs remain
protected. This is test isolation, not a change to normal Chromium upgrade rules.

The normal interactive desktop test reached a visibly successful native About
page, but the first text verifier read innerText from shadow-root fragments and
collected only newlines. Qualification now reads rendered accessibility nodes
and checks the real GoogleUpdate.UpgradeResult histogram's native result4, with
AX/screenshot/histogram evidence retained. Toolbar capture waits for the panel or
welcome UI to render after target creation; target existence alone is too early
for a useful native screenshot. These are verifier fixes; installer bytes and
frozen Mac inputs are unchanged.

Native toolbar qualification dismisses first-run welcome via the real Skip
control when that control is detected, closes the panel via Close Chat Window,
and reopens it with the native AI Assistant toolbar button before capture.
The final capture shows the rendered welcome screen after reopening; it is
evidence of the toolbar/panel lifecycle, not a completed provider conversation.


## November 17 installed desktop result

The retained unsigned x64 installer (130813440 bytes) passed qualification in
an actual interactive standard-user RDP session on Windows Server 2022,
OS10.0.20348, session2, administrator=false. This resolves the prior batch-logon
COM activation failure without weakening DCOM permissions or pre-creating the
installer's missing startup key. No Chromium rebuild was needed for verifier
changes: native input95d6af5bd608ffbe435b9c318be49c0b716584f0 and verifier
4ceb9cdcc17bf0b06ff8835d62b5ca861d45c43b.

Installer SHA256:
`f75f3a8fc08ffc3037f3c2191ffb4151db10baf50a24ac2355a2b951cff06199`.
Final run `da54cbe7-9c9a-4f5b-b0b4-895d8719bdf5` completed at
2026-11-17T11:32:09Z with desktop-summary.passed=true. Installation, installed
updater payload hashes/registrations, native toolbar open/close/reopen, real AI
JavaScript/accessibility/screenshot tools, six privileged-URL restrictions and
the AI update action all passed. About displayed158.0.8127.18 (Official Build)
(64-bit). The native GoogleUpdate.UpgradeResult histogram recorded result4
(ALREADY_UP_TO_DATE), corroborated by the HTTPS/CUP updater log and Cloud Run's
Windows/browser/updater-GUID noupdate responses. The enabled per-user updater
wake task and HKCU Run startup command were read back successfully.

This qualifies an internal unsigned Windows158 installation and native no-update
check. It does not qualify Windows158-to159 payload delivery, signed public
Windows distribution, Windows10/11 client hardware, or provider conversations.
The final toolbar report has welcome_skipped=false; its screenshot shows the
welcome screen, so do not claim the final run completed onboarding.
The production catalog remains unchanged and publication stays held until owner
merge. Frozen Mac0.7.0 R2 artifacts and inputs remain untouched.

The separately approved USD1 desktop-test VM, its60GB disk and dedicated IAP
firewall/subnet/network were deleted after evidence collection. The original
USD20 build pilot, token, secret and dedicated identity/network were also cleaned
up. Standalone harness and cleanup guard tests are retained in private CI PR10.
Earlier focused Claude reviews found no definite blockers. Review of these
latest verifier/harness changes remains pending: the local CLI session expired
and the GitHub review action reports that the Claude App is not installed.
