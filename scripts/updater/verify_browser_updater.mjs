// Observe the real native updater callback through the installed About WebUI.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {CDP} from '../chromium_cdp.mjs';

const [endpoint, expectedVersion, expectedStatus, output] = process.argv.slice(2);
assert.ok(endpoint && expectedVersion && expectedStatus && output, 'endpoint version status artifacts required');
// UPDATING is emitted only after the native authenticated check accepts an
// offer. This probe checks transport/authentication, not installation success.
const accepted = expectedStatus === 'successful-check' ? new Set(['updated', 'updating', 'nearly_updated']) : new Set([expectedStatus]);
const artifacts = resolve(output);
await mkdir(artifacts, {recursive: true});
const version = await fetch(`${endpoint}/json/version`).then(r => r.json());
assert.equal(version.Browser.split('/').at(-1), expectedVersion);
const browser = await CDP.connect(version.webSocketDebuggerUrl);
let page;
try {
  const created = await browser.send('Target.createTarget', {url: 'chrome://settings/help'});
  for (let attempt = 0; attempt < 60; attempt++) {
    const targets = await fetch(`${endpoint}/json/list`).then(r => r.json());
    const target = targets.find(t => t.id === created.targetId && t.webSocketDebuggerUrl);
    if (target) {
      page = await CDP.connect(target.webSocketDebuggerUrl);
      break;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  assert.ok(page, 'About page must be inspectable');
  const expression = String.raw`(() => {
    function find(root = document) {
      const about = root.querySelector('settings-about-page');
      if (about) return about;
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot) {
          const nested = find(element.shadowRoot);
          if (nested) return nested;
        }
      }
    }
    const about = find();
    if (!about?.currentUpdateStatusEvent_) return null;
    return {
      status: about.currentUpdateStatusEvent_.status,
      message: about.shadowRoot.querySelector('#updateStatusMessage')?.innerText,
      text: [...about.shadowRoot.querySelectorAll('settings-section')].map(s => s.innerText).join('\n'),
      icon: about.getUpdateStatusIcon_(),
    };
  })()`;
  let state;
  const history = [];
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const evaluated = await page.send('Runtime.evaluate', {expression, returnByValue: true});
    assert.ok(!evaluated.exceptionDetails, JSON.stringify(evaluated.exceptionDetails));
    state = evaluated.result.value;
    if (state && state.status !== history.at(-1)?.status) {
      history.push({time: new Date().toISOString(), ...state});
      console.log(JSON.stringify({status: state.status, message: state.message}));
    }
    if (accepted.has(state?.status) || state?.status?.startsWith('failed')) break;
    await new Promise(r => setTimeout(r, 500));
  }
  await writeFile(join(artifacts, 'native-updater-report.json'), JSON.stringify({
    runningVersion: version.Browser, expectedStatus, state, history,
  }, null, 2));
  const screenshot = await page.send('Page.captureScreenshot', {format: 'png'});
  await writeFile(join(artifacts, 'native-updater.png'), Buffer.from(screenshot.data, 'base64'));
  assert.ok(accepted.has(state?.status), JSON.stringify(state));
  assert.ok(state.text.includes('Official Build'));
} finally {
  page?.close();
  browser.close();
}
