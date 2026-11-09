# Local Chromium build notes

Updated: 2026-11-05 (America/Los_Angeles).

The active stable 158 release upgrade is documented in
[chromium-158-release-upgrade.md](chromium-158-release-upgrade.md). The 148
component build below is historical; its output was removed after backing up
the source changes and build configuration.

## Checkouts and integration

- Browser Operator frontend: `/Users/tyson/codebase/browser-operator-core`.
- Chromium fork: `/Users/tyson/chromium/src`, version 148.0.7778.56.
- Installed Browser Operator app is version 144.0.7548.0; it is not a build of
  this Chromium checkout.
- The fork already has branding, an AI toolbar button, and DevTools CORS changes.
  Preserve these existing changes.
- Stock frontend was clean before integration. It was moved to
  `third_party/devtools-frontend/src.chromium-original`. The standard `src`
  location now symlinks to the Browser Operator frontend checkout, so the
  browser build embeds Browser Operator.
- Do not run `gclient sync` blindly across the frontend symlink. Revisit the
  local dependency arrangement before syncing or rolling either checkout.

## Frontend issues resolved

1. Root dependencies were absent. `npm ci` fails because the lockfile omits
   optional platform packages. The configured npm mirror is `npm.skia.org`.
   Working install command:
   `npm install --legacy-peer-deps --package-lock=false --registry=https://registry.npmjs.org`.
   Omitting `--legacy-peer-deps` pulled in a large unrelated peer dependency tree.
2. Standalone build support was missing. The development launcher copies
   Chromium's build support and reuses local build tools. A direct symlink to
   Chromium's `build/` caused `build_with_chromium` value collisions; the copied
   standalone `build/config/gclient_args.gni` must say `false`.
3. Resource validation failed for 47 missing entries. Added the generated
   Browser Operator resources to `config/gni/devtools_grd_files.gni`.
4. Unbundled frontend startup made many concurrent module requests. Chromium
   returned synthetic `HTTP/1.1 404 Not Found` bodies as JavaScript, producing
   misleading `SyntaxError: Unexpected number`. The development HTTP server
   now uses a request queue of 512; 256 concurrent requests passed. After a
   browser network-service restart, reloading DevTools was also necessary.
5. Python HTTPServer reverse DNS resolution delayed startup. The launcher
   skips that lookup when binding to loopback.
6. macOS Keychain prompts blocked first browser startup. The user dismissed
   the prompt. Do not enter or request passwords for this test profile.
7. The esbuild dependency must not symlink through the stock frontend `src`
   path once it points back to Browser Operator. Copied the local esbuild
   directory before replacing the Chromium frontend path.

## Verified development setup

- `npm run chromium:dev` builds and launches the local frontend.
- Frontend resource checks pass; the default development build transpiles with
  esbuild and skips full TypeScript checking.
- The AI panel renders. Actual ExecuteJavaScriptTool, GetAccessibilityTreeTool,
  and TakeScreenshotTool calls passed against an isolated test tab.
- Model conversations have not been tested; provider credentials are absent.
- Current development profile is `out/browser-operator-profile` in the frontend
  checkout. The running test used HTTP port 8000 and debugging port 9333.

## Native Chromium build

Output directory: `/Users/tyson/chromium/src/out/BrowserOperator`.

```gn
is_debug = false
is_component_build = true
symbol_level = 0
blink_symbol_level = 0
v8_symbol_level = 0
use_remoteexec = false
use_siso = false
use_system_xcode = true
target_cpu = "arm64"
devtools_skip_typecheck = true
devtools_bundle = false
```

GN generation passed: 29,361 targets from 4,571 files.
Host: 16 GB RAM, 10 logical CPUs, Xcode 26.3. Approximately 43 GB free before
the build. Started with five jobs, then increased to eight after checking
56% system-wide memory availability and zero swap use. During heavier Blink
compilation, swap grew to about 2.9 GB; reduced to six jobs to limit pressure.
Monitor memory and disk.

```sh
cd /Users/tyson/chromium/src
./buildtools/mac/gn gen out/BrowserOperator
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer \
  ./third_party/ninja/ninja -C out/BrowserOperator chrome -j 6
```

GN log: `/private/tmp/browser-operator-chromium-gn.log`.
Compiler log: `/private/tmp/browser-operator-chromium-build.log`.

## Native build issues

1. At action 6,435, ANGLE's `angle_metal_internal_shaders_to_air` failed:
   `cannot execute tool 'metal' due to missing Metal Toolchain`.
   Xcode 26.3 is installed, but its optional Metal component was absent.
   Installed it with Apple's `xcodebuild -downloadComponent MetalToolchain`;
   download log: `/private/tmp/browser-operator-metal-toolchain.log`.
   Download succeeded but `xcrun metal` initially still reported the component
   missing. Clearing the stale tool cache with
   `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun --kill-cache`
   resolved this outside the sandbox. `xcrun metal --version` then returned
   Apple metal 32023.864. Resume commands explicitly set the same DEVELOPER_DIR.
2. Metal compilation then failed because the workspace sandbox denied writes
   to `/Users/tyson/.cache/clang/ModuleCache`. Resumed the Ninja build outside
   the sandbox, with the same arguments; no shader source changes required.

## Completed native build and verification

Status: **native build completed successfully**, Ninja exit status 0. All
55,615 original build actions completed across incremental resumes.

App: `/Users/tyson/chromium/src/out/BrowserOperator/Browser Operator.app`.
Version: **148.0.7778.56**. This is a development component build: keep the app
inside its output directory, alongside the component libraries. It is not a
standalone redistributable app package.

The fork's modified toolbar view, DevTools UI/CORS implementation, and main
delegate compiled. No Chromium C++ source fixes were necessary.

Native verification used **bundled DevTools**, without
`--custom-devtools-frontend` or the development HTTP server:

- The native browser started and reported Chrome/148.0.7778.56 over CDP.
- `Target.openDevTools` opened its bundled frontend.
- The accessibility tree contained the Browser Operator welcome screen and
  AI Assistant panel, settings menu, model selector, and chat controls.
- Actual ExecuteJavaScriptTool, GetAccessibilityTreeTool, and TakeScreenshotTool
  calls succeeded against an isolated local test page.
- Provider credentials remain absent; model conversations were not tested.

The Mac was initially locked when the build finished. After the user unlocked
it and dismissed the Keychain prompt, native desktop verification passed:
the bundled welcome screen and AI Assistant chat controls rendered correctly,
and the toolbar AI Assistant button opened the panel. The normal headed launch
uses `out/BrowserOperator/verification-profile` and debug port 9444.
Headless verification used a separate disposable profile,
`--use-mock-keychain`, and debug port 9445 to avoid accessing the user's keychain.
The mock keychain flag was only used for that headless test.

Startup logged quarantine-attribute removal warnings and display-link fallback
warnings while locked; these did not prevent headless startup or tool execution.
Native startup logs: `/private/tmp/browser-operator-native.log` and
`/private/tmp/browser-operator-native-headless.log`.

Launch the compiled app directly, or use `npm run chromium:dev` to run it with
the current frontend checkout. The development launcher now prefers the
`out/BrowserOperator` build over the older installed app.

## Existing upstream patch scripts

User identified the authoritative repository:
https://github.com/BrowserOperator/build-script

Cloned to `/Users/tyson/chromium/build-script`, commit `c236edd` (2025-08-28).
It provides text branding, theme assets, executable renaming, the AI toolbar
patch, and Linux AppImage packaging. Do not duplicate that workflow unnecessarily.

Actual commands differ from its README:

```sh
python3 /Users/tyson/chromium/build-script/smart_rebrand.py \
  --base-path /path/to/fresh/chromium/src --dry-run
python3 /Users/tyson/chromium/build-script/copy_assets.py \
  /path/to/fresh/chromium/src --dry-run
cd /path/to/fresh/chromium/src
git apply --check /Users/tyson/chromium/build-script/0001-executable-renaming-browseroperator.patch
git apply --check /Users/tyson/chromium/build-script/0002-AI-Assistant-button-clean.patch
```

Compatibility checks used isolated pristine files from the local Chromium 148
HEAD (`2168922908ef32ab99e4310be3c5bfb640702dce`), without modifying the built fork:

- Executable-renaming patch: `git apply --check` passed.
- AI toolbar patch: requires rebase at `theme_resources.grd`, `toolbar_view.cc`,
  and `toolbar_view.h`. These are 2025 patches, not a guaranteed newer-version port.
- Both Python dry-run commands completed against the existing checkout.
- README incorrectly uses a positional path for smart_rebrand.py and names
  a nonexistent `0002-Added-custom-button.patch`.
- `copy_assets.py` deletes each destination theme directory before copying.
  Review newer Chromium assets before applying it to avoid losing required files.
- This repository does not include DevTools frontend linkage or the fork's
  DevTools CORS changes. Those remain separate integration steps.

Dry-run logs: `/private/tmp/browser-operator-branding-dry-run.log` and
`/private/tmp/browser-operator-assets-dry-run.log`.
