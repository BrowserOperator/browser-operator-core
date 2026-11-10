# DevTools security backports (2026-11-09)

This change backports the two missing frontend security fixes confirmed in the
initial audit. It is not a complete upstream DevTools update or an exhaustive
security audit. The fork's last observed upstream parent was
`5a64dbbf418936d4cf83b30e070da8c855dfbfd8` (2025-10-07); Chromium 159 pins
`e1df1f10d345d52b88827564aa71ec3ea8462151`.

## Upstream provenance and adaptation

- [22f74fbeb2860d02b55f6481baf352006c158b9f](https://chromium.googlesource.com/devtools/devtools-frontend/+/22f74fbeb2860d02b55f6481baf352006c158b9f)
  (2026-05-19, bug 513758833): keep editable suggestion text inert on focus by
  assigning `textContent`, rather than parsing it through `innerHTML`. The
  production fix is copied verbatim.
- [c98961307b92b731acef5fee919d915eef4086d8](https://chromium.googlesource.com/devtools/devtools-frontend/+/c98961307b92b731acef5fee919d915eef4086d8)
  (2026-05-26, bug 514023351): construct a font-face rule through `CSSStyleSheet`
  and serialize its properties, quoting the URL with `JSON.stringify`. Adapted
  to the fork's imperative `FontView.onFontContentLoaded`; its existing content
  loading and preview sizing lifecycle is retained. Upstream's charset injection
  regression is adapted to this lifecycle, with fallback-URL, quote/backslash,
  and normal-input coverage added.

No `front_end/panels/ai_chat` files or dependencies are changed. Its Git tree
remains `ae68eac380f22e20a71a72efceb2a757acf00959` relative to the PR base
`e1260c380ba06d0bb2a1a96d2a4f87daf55d1781`.

## Validation

The original five new tests were first run without the production fixes: the
HTML case and both malicious font URL cases failed (3 failures), while ordinary
text and font rule cases passed (2 successes). Applying the fixes made all 5
pass. A sixth regression covers literal quotes and backslashes in fallback URLs.
All 18 tests in the combined suggestion-input and source-frame suites pass,
including the existing WebAssembly disassembly tests. Their worker entrypoint
must be built for the standalone test environment.
Tests use the actual Karma/Puppeteer harness with a disposable headless profile,
not mocked DOM or CSS parsing. Browser executable: signed Browser Operator 158
on macOS arm64. Full TypeScript checking was enabled for the targeted GN build.
Repository lint passed on the changed TypeScript files.

The standalone frontend build used `use_siso=false devtools_bundle=false
 devtools_skip_typecheck=false`. Build the test dependencies and runtime assets:

```sh
ninja -C out/SecurityFixes -j 1 \
  front_end/ui/components/suggestion_input:unittests \
  front_end/ui/legacy/components/source_frame:unittests \
  front_end/core/i18n/locales:locales \
  front_end/entrypoints/wasmparser_worker:worker_entrypoint \
  test/unit:karma test:run

python3 third_party/node/node.py --output scripts/run_on_target.mjs \
  --target SecurityFixes gen/test/run.js --skip-ninja --headless \
  --chrome-binary "/path/to/Browser Operator.app/Contents/MacOS/Browser Operator" \
  front_end/ui/components/suggestion_input \
  front_end/ui/legacy/components/source_frame
```

The security branch was developed in a separate worktree based on the native
macOS updater PR. The Intel Chromium build started earlier uses the original
frontend checkout. Existing DMGs and that build do not contain these backports;
packaged-app validation requires a subsequent build containing this change.
