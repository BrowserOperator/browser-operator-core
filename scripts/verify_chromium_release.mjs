import {CDP} from './chromium_cdp.mjs';
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';

// Usage: node scripts/verify_chromium_release.mjs [CDP endpoint] [version] [artifact directory]
// Use a disposable browser profile; this opens a local test page and DevTools.
const endpoint = process.argv[2] ?? 'http://127.0.0.1:9445';
const expectedVersion = process.argv[3] ?? '158.0.8127.18';
const artifacts = resolve(process.argv[4] ?? join(tmpdir(), 'browser-operator-release-verification'));
const expectedProductVersion = process.argv[5];
await mkdir(artifacts, {recursive: true});
const version = await fetch(`${endpoint}/json/version`).then(r => r.json());
assert.equal(version.Browser.split('/').at(-1), expectedVersion);


const browser = await CDP.connect(version.webSocketDebuggerUrl);
let frontend;
try {
  const html = '<title>Browser Operator Release Smoke</title><h1>Release verification</h1><button>Test action</button>';
  const page = await browser.send('Target.createTarget', {
    url: 'data:text/html,' + encodeURIComponent(html),
  });
  const opened = await browser.send('Target.openDevTools', {targetId: page.targetId});
  let target;
  for (let attempt = 0; attempt < 30; attempt++) {
    const targets = await fetch(`${endpoint}/json/list`).then(r => r.json());
    target = targets.find(t => t.id === opened.targetId && t.webSocketDebuggerUrl);
    if (target) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(target, 'Bundled DevTools target must be inspectable');
  assert.ok(target.url.startsWith('devtools://'), target.url);
  assert.ok(!target.url.includes('custom-devtools'), target.url);
  frontend = await CDP.connect(target.webSocketDebuggerUrl);
  await frontend.send('Runtime.enable');
  let checks;
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = await frontend.send('Runtime.evaluate', {
      expression: `(async () => {
        const SDK = await import('./core/sdk/sdk.js');
        return Boolean(SDK.TargetManager.TargetManager.instance().primaryPageTarget());
      })()`,
      awaitPromise: true, returnByValue: true,
    });
    if (result.result?.value === true) break;
    if (attempt === 29) throw new Error('Frontend never attached to the test page');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  // Release bundles expose public entrypoints; inspect their live module scope
  // to invoke the same registered tools the AI panel uses, without importing
  // development-only dependency graphs or altering production exports.
  const entry = await frontend.send('Runtime.evaluate', {
    expression: "import('./panels/ai_chat/ai_chat.js').then(m => m.AIChatPanel.AIChatPanel)",
    awaitPromise: true,
  });
  const properties = await frontend.send('Runtime.getProperties', {objectId: entry.result.objectId});
  const scopes = properties.internalProperties.find(p => p.name === '[[Scopes]]').value.objectId;
  const scopeList = await frontend.send('Runtime.getProperties', {objectId: scopes});
  let registry;
  for (const scope of scopeList.result.filter(p => p.value?.description === 'Module')) {
    const bindings = await frontend.send('Runtime.getProperties', {objectId: scope.value.objectId});
    // Official bundles minify local binding names. Identify the same live
    // registry by its public static methods rather than a development name.
    registry = bindings.result.find(p => p.name === 'ToolRegistry' ||
      (p.value?.type === 'function' &&
       /static getRegisteredTool\s*\(/.test(p.value.description ?? '') &&
       /static getToolInstance\s*\(/.test(p.value.description ?? '')))?.value;
    if (registry) break;
  }
  assert.ok(registry?.objectId, 'Expected live bundled tool registry');
  checks = await frontend.send('Runtime.callFunctionOn', {
    objectId: registry.objectId,
    functionDeclaration: `async function() {
      const code = this.getRegisteredTool('execute_code');
      const content = this.getRegisteredTool('get_page_content');
      const capture = this.getRegisteredTool('take_screenshot');
      if (!code || !content || !capture) throw new Error('Missing registered tool');
      const executed = await code.execute({code: 'document.title', reasoning: 'Verify native release'});
      const tree = await content.execute({reasoning: 'Verify native release'});
      const screenshot = await capture.execute({});
      return {executed, tree, screenshot};
    }`,
    awaitPromise: true, returnByValue: true,
  });
  assert.ok(!checks.exceptionDetails, JSON.stringify(checks.exceptionDetails));
  const value = checks.result.value;
  assert.equal(value.executed, 'Browser Operator Release Smoke');
  assert.ok(!value.tree.error, value.tree.error);
  assert.match(JSON.stringify(value.tree.simplified), /Release verification/);
  assert.ok(value.screenshot.imageData?.startsWith('data:image/png;base64,'), JSON.stringify(value.screenshot));
  await writeFile(join(artifacts, 'page.png'),
    Buffer.from(value.screenshot.imageData.split(',')[1], 'base64'));
  await frontend.send('Accessibility.enable');
  const tree = await frontend.send('Accessibility.getFullAXTree');
  const names = tree.nodes.map(n => n.name?.value).filter(Boolean);
  assert.ok(names.some(name => /Browser Operator|AI Assistant/.test(name)), 'Expected branded frontend');
  let nativeUpdates;
  if (expectedProductVersion) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const inspected = await frontend.send('Runtime.evaluate', {expression: `(() => {
        function find(root) {
          const banner = root.querySelector('ai-version-banner');
          if (banner) return banner;
          for (const element of root.querySelectorAll('*')) {
            if (element.shadowRoot) { const found = find(element.shadowRoot); if (found) return found; }
          }
        }
        const banner = find(document);
        return {native: banner?.nativeUpdater, text: banner?.shadowRoot?.textContent};
      })()`, returnByValue: true});
      assert.ok(!inspected.exceptionDetails, JSON.stringify(inspected.exceptionDetails));
      nativeUpdates = inspected.result.value;
      if (nativeUpdates?.native === true && nativeUpdates.text?.includes('Check for updates')) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(nativeUpdates.native, true, 'Expected the native updater entry, not a GitHub frontend notice');
    assert.ok(nativeUpdates.text.includes(expectedProductVersion), nativeUpdates.text);
    assert.ok(nativeUpdates.text.includes('Check for updates'));
    assert.ok(!/New version|View Release|0\.6\.0/.test(nativeUpdates.text));
    const before = new Set((await browser.send('Target.getTargets')).targetInfos.map(t => t.targetId));
    const clicked = await frontend.send('Runtime.evaluate', {expression: `(() => {
      function click(root) {
        const banner = root.querySelector('ai-version-banner');
        if (banner) {
          const button = [...banner.shadowRoot.querySelectorAll('button')].find(b => b.textContent.includes('Check for updates'));
          if (!button) return false;
          button.click(); return true;
        }
        for (const element of root.querySelectorAll('*')) if (element.shadowRoot && click(element.shadowRoot)) return true;
        return false;
      }
      if (!click(document)) throw new Error('Native updater action missing');
    })()`});
    assert.ok(!clicked.exceptionDetails, JSON.stringify(clicked.exceptionDetails));
    let opened;
    for (let attempt = 0; attempt < 60; attempt++) {
      opened = (await browser.send('Target.getTargets')).targetInfos.find(t => !before.has(t.targetId) && t.url === 'chrome://settings/help');
      if (opened) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(opened, 'AI panel must open the real native About/update page');
    nativeUpdates.openedURL = opened.url;
    // The narrow update-page action must not unlock arbitrary chrome:// pages.
    const blockedURLs = ['chrome://settings/passwords', 'chrome://settings/help',
      'chrome://help/x', 'chrome://help/?a', 'chrome://help/#x', 'chrome-untrusted://settings/'];
    for (const url of blockedURLs) {
      const previous = new Set((await browser.send('Target.getTargets')).targetInfos.map(t => t.targetId));
      const attempted = await frontend.send('Runtime.evaluate', {expression:
        `import('./core/host/host.js').then(h => h.InspectorFrontendHost.InspectorFrontendHostInstance.openInNewTab(${JSON.stringify(url)}))`, awaitPromise: true});
      assert.ok(!attempted.exceptionDetails, JSON.stringify(attempted.exceptionDetails));
      let rejected;
      for (let attempt = 0; attempt < 30; attempt++) {
        rejected = (await browser.send('Target.getTargets')).targetInfos.find(t => !previous.has(t.targetId) && t.type === 'page');
        if (rejected?.url && rejected.url !== 'about:blank') {
          assert.fail(`Privileged URL was opened: ${rejected.url}`);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(rejected?.url, 'about:blank', `Privileged URL must retain stock blocking: ${url}`);
      await browser.send('Target.closeTarget', {targetId: rejected.targetId});
    }
    nativeUpdates.otherPrivilegedURLs = {status: 'blocked', urls: blockedURLs};
  }
  const report = {
    version: version.Browser,
    frontendURL: target.url,
    executeJavaScript: value.executed,
    accessibilityTree: value.tree,
    screenshotWorks: true,
    frontendLabels: names,
    processInfo: (await browser.send('SystemInfo.getProcessInfo')).processInfo,
    nativeUpdates,
  };
  await writeFile(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({...report, accessibilityTree: 'passed'}, null, 2));
} finally {
  frontend?.close();
  browser.close();
}
