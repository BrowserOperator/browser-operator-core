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
