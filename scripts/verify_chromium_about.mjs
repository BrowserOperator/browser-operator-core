// Verify the actual shipping About page, including disabled-updater semantics.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {CDP} from './chromium_cdp.mjs';

const endpoint = process.argv[2] ?? 'http://127.0.0.1:9445';
const artifacts = resolve(process.argv[3] ?? join(tmpdir(), 'browser-operator-about-verification'));
await mkdir(artifacts, {recursive: true});
const version = await fetch(`${endpoint}/json/version`).then(r => r.json());
const browser = await CDP.connect(version.webSocketDebuggerUrl);
let page;
try {
  const created = await browser.send('Target.createTarget', {url: 'chrome://settings/help'});
  for (let attempt = 0; attempt < 60; attempt++) {
    const tabs = await fetch(`${endpoint}/json/list`).then(r => r.json());
    const target = tabs.find(t => t.id === created.targetId && t.webSocketDebuggerUrl);
    if (target) {
      page = await CDP.connect(target.webSocketDebuggerUrl);
      break;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  assert.ok(page, 'About target must be inspectable');
  const findAbout = `function findAbout(root = document) {
    const found = root.querySelector('settings-about-page');
    if (found) return found;
    for (const element of root.querySelectorAll('*')) {
      if (element.shadowRoot) {
        const found = findAbout(element.shadowRoot);
        if (found) return found;
      }
    }
  }`;
  let result;
  for (let attempt = 0; attempt < 60; attempt++) {
    const evaluated = await page.send('Runtime.evaluate', {
      expression: `(async () => { ${findAbout}
        const {loadTimeData} = await import('chrome://resources/js/load_time_data.js');
        const about = findAbout();
        if (!about?.shadowRoot) return null;
        const status = about.shadowRoot.querySelector('#updateStatusMessage');
        if (!status || !status.innerText.includes('Install new Browser Operator releases manually.')) return null;
        const text = [...about.shadowRoot.querySelectorAll('settings-section')]
          .map(section => section.innerText).join('\\n');
        return {text, message: status.innerText, hidden: status.hidden,
          state: about.currentUpdateStatusEvent_?.status,
          profilesLabel: loadTimeData.getString('peoplePageTitle'),
          aiLabel: loadTimeData.getString('aiPageTitle'),
          learnMoreHidden: status.querySelector('a')?.hidden,
          icon: about.getUpdateStatusIcon_()};
      })()`, awaitPromise: true, returnByValue: true,
    });
    assert.ok(!evaluated.exceptionDetails, JSON.stringify(evaluated.exceptionDetails));
    result = evaluated.result?.value;
    if (result) break;
    await new Promise(r => setTimeout(r, 250));
  }
  assert.ok(result, 'Expected explicit manual-update message');
  assert.equal(result.state, 'disabled');
  assert.equal(result.hidden, false);
  assert.equal(result.learnMoreHidden, true);
  assert.equal(result.icon, '');
  assert.equal(result.profilesLabel, 'Profiles');
  assert.ok(['AI in Browser Operator', 'AI innovations'].includes(result.aiLabel), result.aiLabel);
  assert.ok(result.text.includes('Official Build'), result.text);
  assert.ok(!result.text.includes('Developer Build'), result.text);
  assert.ok(!result.text.includes('An error occurred'), result.text);

  // Exercise the same WebUI event used by the native status callback. A
  // disabled state without a message must retain upstream's hidden behavior.
  const regression = await page.send('Runtime.evaluate', {
    expression: `(async () => { ${findAbout}
      const {webUIListenerCallback} = await import('chrome://resources/js/cr.js');
      const about = findAbout();
      const status = about.shadowRoot.querySelector('#updateStatusMessage');
      webUIListenerCallback('update-status-changed', {status:'disabled', message:'', progress:0});
      await about.updateComplete;
      const blankDisabledHidden = status.hidden;
      webUIListenerCallback('update-status-changed', {status:'failed', message:'Release verification error', progress:0});
      await about.updateComplete;
      const realErrorVisible = !status.hidden && !status.querySelector('a').hidden &&
        about.getUpdateStatusIcon_() === 'cr:error-filled';
      webUIListenerCallback('update-status-changed', {status:'disabled', message:${JSON.stringify(result.message)}, progress:0});
      await about.updateComplete;
      return {blankDisabledHidden, realErrorVisible};
    })()`, awaitPromise: true, returnByValue: true,
  });
  assert.ok(!regression.exceptionDetails, JSON.stringify(regression.exceptionDetails));
  assert.deepEqual(regression.result.value, {blankDisabledHidden: true, realErrorVisible: true});
  const report = {version: version.Browser, ...result, regression: regression.result.value};
  await writeFile(join(artifacts, 'about-report.json'), JSON.stringify(report, null, 2));
  const capture = await page.send('Page.captureScreenshot', {format: 'png'});
  await writeFile(join(artifacts, 'about.png'), Buffer.from(capture.data, 'base64'));
  console.log(JSON.stringify({version: version.Browser, officialBuild: true, manualUpdates: true,
    updaterStateRegression: 'passed', artifacts}, null, 2));
} finally {
  page?.close();
  browser.close();
}
