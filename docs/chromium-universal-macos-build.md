# Universal macOS 159 build

Started 2026-11-09. Intel compilation is running; no universal DMG is complete
or qualified yet. The signed ARM64 artifacts and immutable inputs are preserved.

## Inputs and build

Chromium 159.0.8144.0, source f19f8ee8a6b566fbd0cea6bdf05e284712cba9b9.
ARM64 frozen inputs: /Users/tyson/chromium/updater-test/159-cloud-frozen-input.
Intel output: /Users/tyson/chromium/src/out/Release_x64.
Both use the same updater test identity, endpoint/public keys, frontend and
official optimization settings. Only target_cpu differs. The cloud endpoint
is temporary; these are qualification inputs, not production release inputs.

```sh
python3 scripts/build_chromium_release.py \
  --chromium-src /Users/tyson/chromium/src \
  --build-dir out/Release_x64 --target-cpu x64 \
  --gn-config //third_party/devtools-frontend/src/config/chromium-autoupdate-cloud-test-mac-x64.gn \
  --extra-target chrome/updater/mac:updater_zip \
  --extra-target clang_arm64/crx3_build_action \
  --extra-target third_party/devtools-frontend/src/scripts/updater/native:browser_operator_update_verify \
  --log /private/tmp/browser-operator-159-x64-build.log
```

Runner log: /private/tmp/browser-operator-159-x64-runner.log.
The native cross-build needs the ARM64 host CRX tool at
clang_arm64/crx3_build_action; the default-toolchain short label is absent.
PGO uses the exact mac profile pinned by this Chromium source; ARM64 uses
mac-arm. V8 profiles are downloaded for the matching native source revision.
Six jobs and a 5 GiB free-space guard bound host resource use.

Initial storage: about 29 GiB free; ARM64 output 7.3 GiB. No existing build
outputs or signed releases were deleted. Each architecture gets its own build
directory, and no concurrent Ninja runs share a directory.

## Remaining before distribution

After Intel completes, verify/freeze its inputs and source/config provenance.
Use Chromium's chrome/installer/mac/universalizer.py to merge both browser
bundles AND the standalone updater app/utility. Architecture-specific snapshot
resources must survive; all bundled Mach-O executables/libraries must contain
both arm64 and x86_64 slices. Resource mismatches must fail, not be discarded.
Retain the architecture-independent signing tools and ARM64 host crypto tools.

The existing direct DMG packager still explicitly requires ARM64 input. It now
rejects Intel input before notarization, preventing a mislabeled arm64 DMG.
Universal architecture-aware signing/packaging verification must be completed
before producing a universal final DMG. Nested Developer ID signing,
notarization/stapling, Gatekeeper, and architecture/runtime tests remain required.
An actual Intel Mac test is still needed; no Intel runtime qualification is
claimed by successful cross-compilation alone. Intel auto-update payload/feed
qualification is separate; the current cloud service offers ARM64 payloads only.
The confirmed upstream frontend security gaps also remain pending.

## Initial issues resolved

- Root frontend GN qualification group read build_with_chromium before vars.gni
  imported it. Move the group below imports; standalone and native generation
  now both pass. This correction is in the parent native-updater PR.
- Cross-compilation exposes crx3_build_action under the ARM64 host toolchain,
  not the Intel default target alias; use its actual Ninja path above.
- Shared shipping-settings capture accepts explicit arm64/x64 targets. The
  existing packaging entrypoint remains ARM64-only and fails early otherwise.
