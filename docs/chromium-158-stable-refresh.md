# Chromium158 stable refresh

Target158.0.8127.37, upstream commit b8c2be851f62f6a394ec57955d7f31335d7cb6d4.
The previous158.0.8127.18 ARM64/universal R2 DMGs and frozen inputs are preserved.
Builds use BrowserOperator/build-script's reusable entry point and the existing
reviewed core helpers. Production auto-update, stable app identities, CUP/CRX
trust roots, AI chat/native update action, toolbar, branding and CORS integration
remain enabled. No release upload or Omaha catalog promotion is authorized.

The ten ordered native patches and74 pinned branding assets apply cleanly to
pristine158.0.8127.37. The existing reviewed158.0.8127.18 series is reused after this compatibility
check; identical patch files are not duplicated for each engine patch release.
This is not a claim that every future Chromium major version is compatible. Future same-branch builds may compatibility-check the
nearest reviewed baseline with --patch-series-version; new branches need review.

DEPS moves stock DevTools from a7812cf737f651c890965e0c274dd52db2520d33 to
047c90eca37c7170d826d72245d5df9281989cf3. Their five-file delta covers
DOMTreeWidget behavior/tests/CSS and What's New content. This fork does not ship
DOMTreeWidget.ts or that CSS, so those new-widget fixes are not copied as an
unrelated implementation. Existing targeted security backports remain and the
AI chat tree is unchanged. Matching stock DevTools is preserved for pinned tools.

The reusable driver validates old source against reviewed patches, verifies its
backup, restores stock DevTools before gclient, and refuses unknown edits. It
builds both architectures before freezing their common provenance. Completion
requires subprocess success and artifact verification. Driver/core source and
config changes invalidate resume state. Six compile jobs and a5GiB free-space
guard bound this16GiB host. Existing native output directories are reused; prior
signed releases and frozen inputs are never silently removed.

A newer production updater cannot be safely restored to an older installed
baseline merely by launching the old app. Static signing/notarization may emit
an explicit candidate manifest with runtime tests pending. A hash-checked export
lets a real standard test user run the production installed-app/native-updater
tests without access to the signing user's home or credentials. Only completed
runtime checks create a release manifest. No temporary HOME or alternate test
updater identity substitutes for production qualification.

Current validation: patch/branding compatibility, driver safety checks and
candidate-only manifest checks pass. Independent agent review is required before
compilation; actual build/runtime/signing status is recorded in private run logs.
Windows remains queued until Mac ARM64/universal qualification is complete and
will use the same entry point once its version-aware backend is ported/tested.
The existing Windows pilot approval is not authorization for a replacement VM.

Core PR114 stacks on the0.7.0 integration PR111; the reusable driver is
BrowserOperator/build-script PR1. After the parent merges, retarget
this PR to main before owner merge. The publication policy points to this
refresh PR and its complete source tree, and also requires owner merge of driver PR1; old R2 candidates remain held and are
not reused for the newer native version.
