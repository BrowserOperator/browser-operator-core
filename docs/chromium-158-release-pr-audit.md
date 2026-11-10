# Chromium 158 release input and PR audit

The release input audit found branding output that was used locally but not
fully represented by the eight original native feature patches. Patch10 now
captures the exact residual text changes across36 native files. It does not
change the working browser's behavior; it makes its existing branding reviewable
and reproducible. The generated `components/resources/sample_credits.html` is
excluded: Chromium generates license credits from the pinned dependencies.

All74 selected theme inputs match the clean, tracked BrowserOperator/build-script
checkout at c236edd3378906aa9239126707c26597b607698b. Their source/destination paths
and SHA256 values are recorded in `patches/chromium/158.0.8127.18/branding-assets.json`.
The patch helper validates that pinned source and each asset before applying.
No opaque duplicate asset payload or generated license HTML is added to the PR.
Use `--branding-source /path/to/build-script` on a fresh Chromium checkout.

Coverage:

- Chromium integration: PR102; signing/packaging: PR103; native updater: PR104.
- Universal support: PR105 and PR108; security backports: PR106.
- Native AI updater entry and product0.7.0: PR109.
- Exact native branding/asset coverage: this separate stacked audit PR.
- CI preparation/publication: test-github-pipeline PR7 and PR8, with the Windows
  build changes reviewed separately before its candidate pipeline is started.
- Cloud Run backend: private Omaha PR1; no credentials/private keys are committed.

The inherited AI snapshot08a6cc is an ancestor of the head reviewed in merged
PR76, despite its squash-merge ancestry. It is not an unreviewed local AI change.
The current component stack starts from a review-base branch rather than main;
release integration must land the reviewed code in main before publication.
If merging newer main changes alters product inputs, candidates must be rebuilt
and requalified from the resulting source. The release gate must reject stale
artifacts rather than merely trusting that a PR was merged.

Local build queues, signing invocation logs, GUI launch helpers and notarization
account references remain in the private release work directory. They call the
reviewed scripts and are not shipped product source. Recovery `.rej` files,
unused branding variants, stock frontend backups and omitted benchmark checkouts
are not browser runtime modifications. Node_modules changes from the original
checkout remain outside these review branches.

The owner requires all publishing held until merge. The existing private158
release remains unchanged while product0.7.0 candidates are built and notarized.
After merge, public v0.7.0 in browser-operator-core will expose the Mac DMGs to
legacy users, with private copies retained in Omaha. Native Omaha compares the
four-part Chromium version: same158.0.8127.18 rebuilds require the legacy notice
and manual bootstrap; a genuine159 native offer is separately qualified.


Product0.7.0 main integration is PR111 (base main). The final integration
restores main's AI files untouched by release work, removes duplicate AI
settings/resource entries, and compiles both158 architectures. Its frozen
manifest records the five product source trees; publication requires PR111
merged into main with those exact trees. A later product change requires
a rebuild. The Windows candidate is a separate CircleCI change/build and
will not publish an installer or activate a Windows update feed.
