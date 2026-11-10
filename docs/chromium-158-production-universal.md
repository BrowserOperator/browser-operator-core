# Chromium 158 production macOS builds

The requested engine is **158.0.8127.18**, source
`6449d9f9a6a906edff724b7b220199b3fde4615c`. This upstream tag is Beta;
Browser Operator's own `stable` updater channel is a separate release policy.
The build combines the native updater/universal support and the two targeted
DevTools security backports from PR #106. The AI chat tree is preserved.

Standard release configuration now enables auto-update by default. Packaging
also expects it by default; `--manual-updates` is an explicit escape hatch for
historical artifacts. Both architectures use official optimization, PGO phase2,
full frontend type checking and bundled DevTools. ThinLTO is disabled on the
16GiB build host. Total native compile concurrency remains six jobs; every
build stops below 5 GiB free. Intel output/config defaults are distinct from ARM.

## Permanent update identity

- Endpoint: `https://updates.browseroperator.io/service/update2/json`.
- Backend: Cloud Run `browser-operator-omaha`, `us-west1`, project
  `browseroperator-1746729957294`, with direct custom-domain mapping.
- DNS: CNAME `updates` to `ghs.googlehosted.com`, DNS only. Google-managed TLS.
  Direct Cloud Run mapping is a preview feature selected by the owner after
  comparing alternatives; Firebase is not in the final request path.
- Browser ID: `com.browseroperator.BrowserOperator`.
- Updater ID: `com.browseroperator.Updater`, separate from qualification helpers.
- Public configuration: `config/updater/macos-production.gni`.
- CUP public SPKI SHA256:
  `6d772945027df18dd0859e5d607f6157d2218c2686e151e21a3ab443240f9ce7`.
- CRX publisher public SPKI SHA256:
  `793e74189c15bcabab1034d920d45d580dd0f983243ca7d48a0e7d73b3e5809f`.

The CUP private key is held in Secret Manager, secret
`browser-operator-production-cup`, pinned version 1. The runtime service account
can access only that secret. The package-signing private key remains on the
signing Mac, outside repositories. Do not regenerate these keys for a new
browser version: existing clients pin their public trust roots. A backend move
can retain the hostname and keys without rebuilding clients.

The initial stable catalog is deliberately empty. A production 159 release must
be built with these same production identities, signed/notarized, packaged and
qualified before offering it to 158 clients. Earlier 158-to-159 qualification with
test identities is not a substitute for the production rollout check.

## Build, freeze and merge

Use the architecture-specific production configs and output directories:

```sh
python3 scripts/build_chromium_release.py --chromium-src /path/to/chromium/src \
  --target-cpu arm64 --build-dir out/Release_158_arm64 --log /tmp/158-arm64.log
python3 scripts/freeze_chromium_release.py --chromium-src /path/to/chromium/src \
  --build-dir out/Release_158_arm64 --output /path/to/new/arm64-input

python3 scripts/build_chromium_release.py --chromium-src /path/to/chromium/src \
  --target-cpu x64 --build-dir out/Release_158_x64 --log /tmp/158-x64.log
python3 scripts/freeze_chromium_release.py --chromium-src /path/to/chromium/src \
  --build-dir out/Release_158_x64 --output /path/to/new/x64-input

python3 scripts/merge_chromium_macos.py --chromium-src /path/to/chromium/src \
  --arm64 /path/to/new/arm64-input --x64 /path/to/new/x64-input \
  --output /path/to/new/universal-input
```

The builder includes updater, packaging and native crypto-verification tools
automatically. Freezing requires every target current, verifies actual Mach-O
slices and preserves a file inventory. Native and frontend Git revisions,
tracked changes, untracked source/assets, dependency repository states and
resolved updater trust roots are recorded. Both slices must match that
provenance, not just configuration filenames.

Chromium's universalizer merges the browser, embedded/standalone updater and
updater utility. Architecture-specific snapshots survive. All shipped Mach-O
files must have both slices; conflicting non-code resources fail. The only
architecture-specific signing-tool exceptions are `dmg_tool` and `hfs_tool`,
retained from ARM for execution on the signing host, outside the shipped app.

## Sign, notarize and qualify

```sh
python3 scripts/package_chromium_release.py --chromium-src /path/to/chromium/src \
  --frozen-input /path/to/new/arm64-input --architecture arm64 \
  --output /path/to/new/158-arm64-release --keychain-profile tthoma9
python3 scripts/package_chromium_release.py --chromium-src /path/to/chromium/src \
  --frozen-input /path/to/new/universal-input --architecture universal \
  --output /path/to/new/158-universal-release --keychain-profile tthoma9
```

The existing nested Developer ID signing, app/DMG notarization and stapling,
APFS packaging, strict signatures, hardened runtime and Gatekeeper checks are
retained. Each final DMG is mounted read-only and its signatures/tickets are verified.
Functional/About/updater checks run from a writable install copy of that exact
app with disposable profiles. Chromium deliberately refuses updater registration
on read-only mounts; a DMG launch is not a valid installed-updater test. Universal validation requires Rosetta on Apple Silicon
and runs both CPU slices. macOS's public proc API verifies that browser and
renderer processes actually use the requested CPU. Physical Intel hardware
qualification remains distinct from Rosetta execution.

Only a completed `release-manifest.json` establishes a verified output. Read
its per-CPU functional results, updater-test status, trust/provenance and DMG
checksum. Provider conversations require credentials and are not covered by
the local execution/page-content/screenshot tool checks. Use
`--verify-existing` to resume final validation of an already signed/stapled DMG.
Existing manifests and release inputs are never silently overwritten.

## Update packages and CircleCI

`package_macos_update.py` accepts verified ARM64/universal production releases.
It requires the matching frozen input and compiled publisher pin, validates
Apple trust, round-trips the archive through Chromium's own unzip, and verifies
the resulting CRX3 with the native verifier. Use the production keys outside Git.

`publish_macos_release_update.py` uploads the DMG, authenticated CRX and metadata
to `BrowserOperator/browser-operator-releases`. Tags are
`macos-VERSION-arm64` or `macos-VERSION-universal`; every remote asset's size and
SHA256 must match before publishing. Existing published tags/assets are never
clobbered. The existing test publisher retains its separate prerelease mode.
Production publication requires `--build-input` pointing to the same frozen
input used to sign the release. Its manifest digest and inventory must match;
the native verifier rechecks the CRX signature against the compiled publisher
pin before contacting GitHub. Uploads and publication target the verified
release ID, and ambiguous duplicate drafts are rejected.

The prepared ARM64 CircleCI entrypoint always builds/signs the updater.
Production publication is explicitly selected with `publish_release_update=true`
and `update_release_tag=macos-VERSION-arm64`, using protected runner key paths.
Test and production publication/configurations cannot be mixed. The new flags
are opt-in; no remote pipeline execution or publication is implied by local
build/testing. Universal merging/signing uses the commands above.

Publishing assets does not activate a catalog. After a real native upgrade is
qualified, deploy the reviewed `catalog-github.json` as the Cloud Run image's
stable catalog and promote that immutable image. Universal payloads can serve
both Mac CPU types, preserving universal installations; architecture-specific
catalog entries must not overlap. The service rejects wrong channels, ambiguous
architecture entries, non-GitHub production download origins and downgrades.

## Qualification isolation and retries

Native updater checks require a clean dedicated macOS user namespace. Packaging
refuses to replace a pre-existing production or qualification controller. The
smoke test can install its own signed helper; it uninstalls only that newly
created helper, verifies removal of its wake agents, and preserves diagnostics
in the private release evidence. A successful authenticated check may report
up-to-date, downloading or relaunch required; this does not claim an upgrade
installation passed. The feed can therefore advance without invalidating
verification of an older signed release.

Public release assets contain a reduced provenance manifest: detailed local
untracked filenames and absolute symlink targets stay in private audit evidence,
represented publicly by digests. The frozen-input manifest remains private.

Every attempt uses a new output and frozen-input directory. If CI fails after
freezing, preserve the completed input and diagnostics. To retry signing, invoke
the packager directly with that verified `--frozen-input` and a new `--output`.
If a final signed/stapled DMG already exists, use `--verify-existing` with its
original output to resume verification. Never delete or overwrite an accepted
release to make a retry pass. The CircleCI wrapper itself starts fresh and
requires a new `RELEASE_OUTPUT` for a full rerun.

Production promotion accepts only universal payloads covering both CPU types.
Native update requests expose OS architecture, which cannot distinguish ARM64
and universal installations on Apple Silicon. Both installers receive future
universal updates, preserving Intel compatibility. ARM-only catalog candidates
may accompany download assets but must not be activated in the stable service.

Each verification attempt gets a fresh evidence subdirectory; retrying never
truncates the previous smoke test or collides with its retired controller logs.
The release manifest records the successful evidence directory.

DMG-to-install copying crosses volumes and may require a full copy even when
`cp -c` is requested. Successful test installations are removed after helper
cleanup; failed attempts retain the app for diagnosis. Output-volume free space
is checked independently. Detailed verification evidence remains private.
