# macOS shipping workflow and CircleCI review

Current review (2026-11-09): changes are pushed in draft PR
https://github.com/tysonthomas9/test-github-pipeline/pull/7. It also includes
opt-in native updater packaging and test-prerelease publishing, disabled by
default. Select enable_test_updater=true, an updater-enabled release_gn_config,
and publish_test_update=true plus a unique update_test_tag for a test upload.
The prepared signing runner needs local CRX_PRIVATE_KEY/CRX_PUBLIC_KEY paths and
GitHub repo authorization. HTTPS cloud test configuration must be generated on
the runner first; it is ephemeral and not committed. Publication never
activates Omaha. Bash 3.2 syntax/empty-array and YAML parsing checks passed;
CircleCI server validation/remote execution are still pending. Commits use
[skip ci] to avoid launching the existing expensive default jobs for review.

The original audit below was recorded 2026-11-07 (America/Los_Angeles); references
to local/unpushed changes describe that historical checkpoint.

## Existing workflow inspected

Repository: `tysonthomas9/test-github-pipeline`, branch
`feature/mac-sign-notarize`, revision
`30c759099085d7181f9815fd7c6b29fd89fa59a2`.
Local checkout: `/Users/tyson/codebase/test-github-pipeline`.

Inspected `.circleci/config.yml`, `CIRCLECI_TO_MAC_BUILD_PARITY.md`,
`mac-build-arm64.sh`, `mac-build-universal-and-sign.sh`, and
`mac-sign-notarize.sh`, plus the older `test-chromium` Mac release script.

The original configuration on this branch contained Linux and Windows jobs,
with Mac scripts present separately. Added a **local, opt-in** Mac shipping
workflow below. No CircleCI job was triggered and no remote workflow was
changed during this local release.

The older **`feature/mac-build`** branch at
`fffcdbe33291ddadc35bf031152f836d97dc67db` **does contain** a
`build-chromium-macos` job, scheduled alongside Linux and Windows. It uses the
existing self-hosted resource class **`tysonthomas9/macos`**, fetches the latest
Beta version, builds ARM64 and x64, and creates a universal app. Its signing
step is optional blanket `codesign --deep --force`; it creates a DMG/ZIP but
does not notarize or staple them. That earlier job is not equivalent to a
fully validated distribution release.

The current release follows the later branch's generated nested-signing and
notarytool workflow, with pinned stable source and mandatory final checks. It
targets ARM64 and must not be labeled universal. The reviewed commit had no
GitHub commit-status entries available; that is not evidence of a successful
CircleCI run. Cloud pipeline execution has not been validated here.

The local `.circleci/config.yml` now defines
`build-browser-operator-macos-shipping` on the existing `tysonthomas9/macos`
runner. Set pipeline parameter **`run_macos_release=true`** to select that
workflow; the default remains Linux/Windows. The Mac workflow verifies the
prepared source against **`chromium_version`** (default `158.0.8127.18`), calls
`mac-release-shipping.sh`, and collects only the verified DMG, manifest,
Gatekeeper results, and final verification reports. Each CI build gets a
distinct release output directory.

YAML parsing, opt-in workflow structure, and every new shell step passed local
validation. CircleCI CLI/server schema validation and an actual cloud job have
not been run. The self-hosted runner must have the prepared source/frontend,
tools, signing identity, and authenticated keychain profile described below.

Two other issues in the reviewed Linux job are recorded for a separate CI fix:
it computes `PGO_ARGS` without including them in its GN command, and its build
command invokes the Windows `mini_installer` target. The local ARM64 shipping
runner uses explicit PGO settings and macOS browser/packaging targets instead.

The ARM64 script correctly builds both `chrome` and `chrome/installer/mac`.
The signing script correctly uses Chromium's generated nested signing pipeline
and a `notarytool` keychain profile. The shipping runner retains those stages
and adds explicit validation of optimization flags, final signatures,
notarization tickets, Gatekeeper approval, mounted-DMG browser tools, and About.

## Shipping entrypoints

For an already synced, patched Chromium checkout linked to this frontend:

```sh
python3 scripts/build_chromium_release.py \
  --chromium-src /Users/tyson/chromium/src --jobs 6 --min-free-gib 5 \
  --log /private/tmp/browser-operator-158-shipping-build.log

python3 scripts/package_chromium_release.py \
  --chromium-src /Users/tyson/chromium/src \
  --output /Users/tyson/chromium/releases/158.0.8127.18-arm64 \
  --keychain-profile tthoma9
```

The existing pipeline checkout also has a `mac-release-shipping.sh` entrypoint
that delegates to the updated shared build, packaging, and verification
scripts. A prepared self-hosted macOS CircleCI job can invoke that entrypoint.
The runner needs its own signing identity, authenticated notarytool profile,
prepared source/dependencies/frontend, Python 3.11+, Node.js, and Xcode.

This release targets **ARM64**. Existing x64/universal scripts remain separate;
the final ARM64 DMG must not be labeled universal.

## Changes from the older local workflow

- Enable `is_official_build=true`, disable debug/component/runtime DCHECKs,
  and use the exact Chromium ARM64 and V8 PGO profiles. ThinLTO remains off to
  bound memory on this 16 GB Mac.
- Enable full DevTools type checking. Remove unreachable onboarding statements
  caught by the stricter preflight, rather than skipping the check.
- Apply the sixth version-specific patch for Settings branding and an honest
  manual-update status. Updater-disabled is neither an error nor an up-to-date
  claim; a real updater is not configured by this release task.
- Apply the seventh patch for remaining product display names and macOS
  file-type descriptions, preserving attribution and internal identifiers.
- Generate packaging tools as part of the browser build. Refuse to sign when
  Ninja still has outstanding work or when effective shipping flags differ.
- Use Chromium's nested signing and hardened-runtime entitlements without
  `--development` or debug-attach entitlements. Sign a staged copy of the app.
- Defer the pre-notarization Gatekeeper check, then require final app **and**
  DMG Gatekeeper acceptance after notarization and stapling. The old script's
  tolerated `spctl` failure does not count as final validation.
- Use a visible `Applications` shortcut in non-Google-branded DMGs.
- Use the shared APFS image adapter and verify the mounted app before DMG
  submission. On this Mac, the legacy HFS hybrid path introduced FinderInfo
  metadata after signing; Apple's acceptance alone did not catch the resulting
  strict-signature failure.
- Refuse to delete or overwrite existing release output. Preserve signing and
  notarization logs, a SHA-256 manifest, About-page results, screenshots, and
  bundled AI-tool test results.

Apple initially returned HTTP 403 for an outstanding developer agreement. The
user accepted the agreement; a subsequent authenticated history request passed.
No credentials are embedded in scripts or notes.
