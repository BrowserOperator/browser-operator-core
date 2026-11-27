# DevTools security changes for Chromium 159

Reviewed stock DevTools from `047c90eca37c7170d826d72245d5df9281989cf3`
to Chromium 159.0.8154.13's pinned
`3d48567555b6795967c376050698efe2bf4f0f98`. The stock delta spans 1,572 files;
this change carries targeted protections into the older fork while retaining
Browser Operator's custom AI panel and previous HTML/font-CSS security fixes.
It does not claim a complete merge of stock DevTools or exhaustive security parity.

The extension `openResource` API now checks the caller's runtime host policy
before revealing source code, page resources or network requests. This follows
the stock implementation, including its distinction between an apparent
`sourceURL` and the script's actual inspected target. Denied resources return a
permission error before resource/network lookup. Allowed custom-scheme scripts
continue to open when their inspected target is permitted.

Stock 159 also has a newer security-origin framework that this fork does not
have. The inherited Google FileAgent therefore receives a conservative adapted
mitigation: only ordinary HTTP(S) network files can share a web origin, and
scripts additionally require known non-synthetic bindings with matching source
origins. Source-mapped, synthetic, local, malformed, opaque and unverifiable
files use a unique identity per file. Provenance is recomputed on every use;
only the opaque identity is cached. Ambiguous files require separate chats.

The inherited agent backend now blocks disallowed context before refreshing or
serializing it and rechecks after asynchronous work and before model requests.
This protects direct backend calls and provenance changes while the UI awaits
data. Browser Operator's separate `panels/ai_chat` implementation is unchanged.

Validation: targeted frontend build with full TypeScript checking passed;
all 80 tests across ExtensionServer, AiAgent and FileAgent passed in actual
headless Browser Operator 158 using disposable test profiles. New regressions
cover denied resource lookups, allowed custom schemes, misleading source URLs,
per-file opaque identities and origin changes during refresh, enhancement and
generator suspension. The extension fixture waits for its mock resource tree
before changing the inspected URL. Targeted ESLint passed.

These results qualify the frontend changes before compiling 159. They do not
substitute for testing the final signed 159 ARM64/universal apps, native updater
or mounted DMGs. Release publication stays held for the matching owner merges.

This is PR115, stacked on PR114. Its final source tree is the required release
merge; parent PR114 and build-script PR1 must also be merged by the owner.
