# Chromium 159 release candidate

The owner selected Chromium **159.0.8154.13**, upstream commit
`4d790f9eb4c8abe65b8aaa3feba664e7c734ba56`. This supersedes the unfinished
158.0.8127.37 packaging target. Its ARM64 and Intel builds, frozen inputs,
universal merge and diagnostics remain preserved. Earlier signed 158 DMGs
remain available as the upgrade baseline.

The new version uses the shared `BrowserOperator/build-script` entry point.
Its ten native patches carry forward the current toolbar, CORS, native AI
update command and complete branding changes. The same 74 theme assets and
two toolbar icons are retained. The earlier 159.0.8144.0 test series is not
used: it lacks the latest AI update and branding patches and belongs to a
different Chromium build branch.

Patch conflicts retain upstream 159 additions and removals. Parsed XML checks
preserve every active upstream message ID, including whitespace-formatted
attributes that text matching misses. The custom manual-update fallback ID is
the sole intentional added message. New Chromium
product labels receive Browser Operator branding. Upstream copyright and
ChromiumOS attribution are preserved.

Production auto-update stays enabled with the existing application identities,
endpoint, CUP key and CRX trust roots. The product version remains 0.7.0.
Production plist metadata explicitly uses the `stable` update channel; test
configurations retain their own architecture-specific channel. Both architecture
inputs must have identical source/frontend provenance before a
universal merge. Signing, Apple notarization, mounted-DMG verification and
actual installed ARM64/x86_64 runtime checks remain required.

The version-aware driver records an explicit per-CPU object-cache layout.
This host reuses `out/Release_158_arm64` and `out/Release_158_x64` without moving
or duplicating them. The directory names are historical; the selected source,
GN settings, app/framework versions and frozen manifests must all prove 159.
The saved layout lets future compatible builds change the release version
without reallocating caches. Six jobs and the 5 GiB reserve remain enforced.
Frozen 158 apps, signed artifacts and logs are not overwritten.

The target's stock DevTools revision is
`3d48567555b6795967c376050698efe2bf4f0f98`. Matching stock tools are synced before
the AI fork is relinked; relevant upstream security changes must be reviewed
against the fork separately. Existing AI behavior and security backports must
survive. A successful stock sync alone is not runtime security qualification.

The release policy names this exact engine version and still requires owner
merge of the final security PR115, parent core PR114 and build-script PR1.
The stack is PR111 → PR114 → PR115; retarget each child to `main` after its
parent merges. The signed candidate must match PR115's final merged tree. No candidate upload,
public release or production Omaha catalog promotion is authorized before the
matching owner merges. Windows follows completed Mac qualification through the
same entry point, with a version-aware Windows backend and actual tests.

Current status is recorded in the private run directory. Patch compatibility,
independent review, compilation, signing and runtime tests are distinct gates;
none may be inferred from a previous version's results.
