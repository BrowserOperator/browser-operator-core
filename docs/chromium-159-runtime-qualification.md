# Chromium 159 runtime qualification

The shared build driver invokes `package_chromium_release.py --verify-existing`
for both signed DMGs, using hash-verified frozen inputs and an explicitly
installed baseline browser of the same version. Native frontend, AI update
action, executable tools, About callback and actual browser/renderer CPU checks
run from disposable installed copies. Universal includes x86_64 under Rosetta.

The baseline browser version must match its registered version and the candidate
browser version. The active updater is an independent signed product and may
legitimately be older. Its identity, team, version-directory agreement, binary
hash, Current target and launch-agent hashes are captured. The same snapshot
must be restored through the permanent browser's native API after each test,
including on failure. The test never edits live preferences, forces helper
activation or uninstalls an existing helper.

For the visible native toolbar, open a blank Guest window in the verified app
and execute `scripts/verify_chromium_toolbar.cua.js` through the Codex computer-use
tool. Set `releaseToolbarOptions` with the verified app path, engine version and
product version. The script refreshes accessibility selectors after each action,
checks open/close/reopen and opens native About from the 0.7.0 banner. Run it for
each DMG's installed app; retain its output with the CLI verification evidence.

This qualifies browser runtime and a real native update check. It does not prove
updater-service self-replacement: a staged 159 helper still requires the real
signed qualification payload before it can replace an active 158 helper. An
empty Omaha catalog returns `noupdate` for that qualifier, so this remains a
separate release gate. Physical Intel hardware and provider conversations also
remain separate from Rosetta and credential-free functional checks.

Release publication, private asset replacement and Omaha promotion remain held
until the owner merges the matching PR stack. No qualification command publishes.
