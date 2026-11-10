# Historical Chromium 159 universal build inputs

This is the earlier test-build checkpoint, superseded by
[the Chromium 158 production release workflow](chromium-158-production-universal.md).
The requested distribution engine is now 158.0.8127.18; do not substitute these
159 test binaries for the production build.

The Intel 159.0.8144.0 compile completed successfully. Its immutable inputs are
`/Users/tyson/chromium/updater-test/159-cloud-x64-frozen-input`; the ARM64 test
inputs remain at `/Users/tyson/chromium/updater-test/159-cloud-frozen-input`.
Source revision: f19f8ee8a6b566fbd0cea6bdf05e284712cba9b9. These use temporary
qualification updater identities, not the permanent production endpoint.

These historical inventories predate the native/frontend source-state and
resolved trust fields now required by the generic merger. They cannot be
passed directly to the production merge command or upgraded by inventing
metadata. A new verified freeze from the matching source is required.
The regenerable 159 output directories were removed after verifying both
immutable snapshots to free storage for the requested 158 rebuild.

Current scripts include architecture-specific build configs, automatic updater
target selection, verified freeze/merge and ARM64/universal signing, notarization
and mounted per-CPU tests. See the current workflow above for commands. The
two targeted upstream DevTools security fixes are tracked separately in PR106.
Rosetta execution and physical Intel hardware qualification remain distinct.
