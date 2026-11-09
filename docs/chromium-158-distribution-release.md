# Chromium 158 shipping DMG

Updated 2026-11-07 (America/Los_Angeles).

Automatic-update qualification started on November 8; see
[the macOS 158-to-159 test notes](chromium-macos-autoupdate-158-to-159.md).
The active source checkout is now genuine 159 Dev for that isolated test.
The signed 158 manual-update artifact and installed app described here remain
unchanged. Upstream 158.0.8127.18 is Beta; official optimization and signing do
not make it an upstream Stable release.

Target: **158.0.8127.18 ARM64**, Chromium source
`6449d9f9a6a906edff724b7b220199b3fde4615c` on
`codex/browser-operator-158`. This follows the local build and readiness audit
in [chromium-158-release-upgrade.md](chromium-158-release-upgrade.md).

## Product and build changes

- Settings navigation: **Profiles** and **AI in Browser Operator** replace the
  remaining mismatched labels. Actual Google-service names and Chromium
  attribution are preserved.
- With `enable_updater=false`, the macOS backend reports disabled with an
  explicit **Automatic updates are not enabled. Install new Browser Operator
  releases manually.** message. The UI displays this message without an error
  icon, spinner, or Google update-error link. Empty disabled messages retain
  upstream's hidden behavior; actual failures retain their error presentation.
- These changes and the WebUI regression test are in the sixth reviewed patch:
  `patches/chromium/158.0.8127.18/06-release-branding-and-manual-updates.patch`.
- A seventh patch updates product-facing Chromium messages (including native
  accessibility/window titles) and macOS file-type descriptions. It preserves
  attribution, URLs, example placeholders, service names, and identifiers.
  All seven patches and both toolbar icons pass fresh-source application and
  reverse checks.
- Shipping settings: `is_official_build=true`, `is_debug=false`,
  `is_component_build=false`, `dcheck_always_on=false`, `chrome_pgo_phase=2`,
  bundled DevTools and full TypeScript checking. ThinLTO stays off to bound
  memory on the 16 GB Mac.
- The build runner downloads the exact ARM64 Chromium PGO profile and V8
  built-in profiles pinned to this checkout, without running gclient across
  the external frontend symlink. It builds `chrome` **and**
  `chrome/installer/mac`, keeps six compile jobs, and stops below 5 GiB free.
- Full official frontend preflight **passed**, including TypeScript and GRD
  resource validation. It exposed two unreachable nullable-button statements
  in onboarding; those statements were removed. Type checking remains enabled.

## Release automation

Build:

```sh
python3 scripts/build_chromium_release.py \
  --chromium-src /Users/tyson/chromium/src --jobs 6 --min-free-gib 5 \
  --log /private/tmp/browser-operator-158-shipping-build.log
```

Sign, notarize, package, and verify the final DMG:

```sh
python3 scripts/package_chromium_release.py \
  --chromium-src /Users/tyson/chromium/src \
  --output /Users/tyson/chromium/releases/158.0.8127.18-arm64 \
  --keychain-profile tthoma9
```

The packaging runner refuses stale build products or non-shipping settings,
selects a valid Developer ID Application identity, and signs a staged copy via
Chromium's generated nested-signing pipeline. It does not use development
signing flags or debug-attach entitlements. It notarizes/staples both the app
and DMG using the existing keychain profile.

The pre-notarization Gatekeeper check is deferred until after notarization;
strict final app and DMG Gatekeeper checks are mandatory. The DMG uses an APFS
adapter (`scripts/chromium_apfs_dmg.py`) with a visible **Applications** shortcut.
The adapter checks the mounted app's strict signature before the DMG is signed
or submitted. The runner validates
signatures, hardened runtime, team identity, tickets, DMG integrity, ARM64,
and functional tests launched from the mounted final DMG. It also runs the
functional checks before signing to catch product/test failures before an
Apple submission. It saves a checksum
manifest, browser logs, About-page screenshot/status regressions, and actual
bundled AI tool results. Existing release output is never deleted or silently
overwritten.

## Pipeline reviewed

See [chromium-macos-release-pipeline.md](chromium-macos-release-pipeline.md).
The existing `test-github-pipeline` checkout on `feature/mac-sign-notarize`
contains the Mac build/sign/notarize scripts; its original workflow scheduled
Linux and Windows only. The older `feature/mac-build` branch does
have a Mac job on `tysonthomas9/macos`, but its optional deep-signing and DMG
steps do not include notarization. Added `mac-release-shipping.sh` and a local
opt-in `run_macos_release=true` workflow using that existing runner. Its YAML
structure and shell steps passed local validation. No remote workflow was
changed and no CircleCI job was triggered; cloud execution remains untested.

## Completed artifact and verification

**Completed 2026-11-07.** Final ARM64 DMG:

`/Users/tyson/chromium/releases/158.0.8127.18-arm64/artifacts/BrowserOperator-158.0.8127.18-arm64.dmg`

SHA-256:
`9c05a935c6112b6636587660f21a83a0068f6b4a4982ee35ba2e6e5a7d930a74`

The native build resumed incrementally after the requested stop at
44,336 / 45,937 actions. The resumed pass completed successfully (exit 0), and
Ninja then reported no work for both browser and packaging targets.

- Full official frontend TypeScript/resource preflight and native build passed.
- Pre-sign bundled JavaScript execution, page content, screenshot, branding,
  native manual-update message, and disabled/failed WebUI regressions passed.
- Developer ID nested signing, secure timestamps, hardened runtime, intended
  team identity, and absence of debug-attach entitlement verified.
- Apple accepted the app submission
  `12131f12-b3d9-4c2e-9e0f-6491fd3c0c9d` and APFS DMG submission
  `43f4e798-0229-4e9d-a0d9-e4124970633a`. App and DMG tickets were stapled and
  validated. Both final app and DMG were accepted by Gatekeeper as
  **Notarized Developer ID**.
- Final DMG checksum, visible Applications shortcut, mounted-app strict/deep
  signature, ARM64 architecture, and mounted-app functional/About regressions
  passed. The release manifest was written only after those checks succeeded.
- Native visual/accessibility testing launched the exact final DMG app through
  macOS Launch Services with an isolated disposable profile. The AI toolbar
  opened the panel; onboarding Skip, provider settings/provider picker, model
  picker, Close Chat Window, toolbar reopen, and toolbar toggle-close passed.
  About visually showed Profiles, AI in Browser Operator, Official Build, and
  the manual-update message without the former error. The owned test app was
  closed and the volume detached afterward.
- Provider conversations were **not tested** because credentials were absent.
  The existing frontend 0.5.0 separately advertises its core 0.6.0 release;
  that frontend banner is distinct from the native browser updater and was
  retained. Automatic browser updating remains intentionally disabled.
- Subsequently installed **158.0.8127.18** into
  `/Applications/Browser Operator.app` at the user's request. The installed copy
  passed strict/deep signature verification and Gatekeeper before replacement.
  Previous app 144 was retained at
  `/Users/tyson/chromium/browser-operator-backups/installed-144-20261107-154355/Browser Operator.app`.
  Opened the installed app normally and confirmed the profile picker was visible
  for the user to select a profile. `installation-report.json` records the paths.

Reports, screenshots, signatures/Gatekeeper evidence, and the checksum manifest
are in `/Users/tyson/chromium/releases/158.0.8127.18-arm64/`:
`release-manifest.json`, `gatekeeper-app.txt`, `gatekeeper-dmg.txt`,
`pre-sign-verification/`, and `verification/` (including `desktop-report.json`).

Build/preflight logs:

- `/private/tmp/browser-operator-158-official-frontend.log`
- `/private/tmp/browser-operator-158-shipping-build.log`
- `/private/tmp/browser-operator-158-shipping-resume-runner.log`
- `/private/tmp/browser-operator-158-package-apfs-runner.log`
- `/private/tmp/browser-operator-158-final-verification.log`
- Release directory `sign-and-notarize.log`

## Issues fixed during distribution validation

Apple initially returned HTTP 403 for an outstanding developer agreement. The
account holder accepted it; authentication and the final submissions succeeded.

The first legacy HFS DMG was accepted by Apple but failed mounted-app strict
signature validation. The HFS hybrid path introduced `com.apple.FinderInfo`
metadata on `app_mode_loader` after signing. That artifact is **not releasable**;
its diagnostics are preserved in
`/Users/tyson/chromium/releases/158.0.8127.18-arm64-failed-hfs-finderinfo`.
A signed-helper APFS regression passed. The shipping pipeline now uses the APFS
adapter and checks the mounted app before DMG submission, as well as afterward.

The hardened-runtime verifier originally expected the literal `(runtime)`;
macOS reports combined flags such as `(kill,restrict,library-validation,runtime)`.
It now checks the individual flags. The valid APFS DMG was verified again using
`--verify-existing`, without rebuilding, signing, or uploading it again.

The About helper's embedded JavaScript newline escaping was corrected before
its first shipping-app run, and embedded-evaluation errors now surface directly.

## Future build and verification recovery

Use the same build command for incremental work; completed unchanged outputs
remain reusable. Do not clean `out/Release` or sync across the external frontend
symlink. An interrupted compile/link restarts only its own unfinished action.
Use a new, empty output directory for each new release.

If packaging has already produced a signed/stapled DMG but final verification
was interrupted before its manifest was written, add `--verify-existing` to the
packaging command. This resumes all final checks without signing/uploading
again. Existing completed manifests are never overwritten. Native visual
checks remain an explicit final step, recorded separately in the desktop report.
