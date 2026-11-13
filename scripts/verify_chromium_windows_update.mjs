import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {CDP} from './chromium_cdp.mjs';

const [endpoint, artifacts] = process.argv.slice(2);
assert.ok(endpoint && artifacts, 'Usage: endpoint artifact-directory');
let target;
for (let n = 0; n < 60; n++) {
  const targets = await fetch(`${endpoint}/json/list`).then(r => r.json());
  target = targets.find(t => t.url === 'chrome://settings/help' && t.webSocketDebuggerUrl);
  if (target) break;
  await new Promise(resolve => setTimeout(resolve, 500));
}
assert.ok(target, 'The AI update entry must have opened the native About page');
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
try {
  let text = '';
  for (let n = 0; n < 180; n++) {
    const result = await cdp.send('Runtime.evaluate', {expression: `(() => {
      function collect(root) {
        let text = root.innerText || '';
        for (const e of root.querySelectorAll('*')) if (e.shadowRoot) text += '\\n' + collect(e.shadowRoot);
        return text;
      }
      return collect(document);
    })()`, returnByValue: true});
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    text = result.result.value ?? '';
    if (/Browser Operator is up to date/.test(text)) break;
    if (/error occurred|failed to check|updates are disabled/i.test(text)) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await writeFile(join(artifacts, 'native-about.txt'), text);
  const capture = await cdp.send('Page.captureScreenshot', {format: 'png'});
  await writeFile(join(artifacts, 'native-about.png'), Buffer.from(capture.data, 'base64'));
  assert.match(text, /158\.0\.8127\.18/);
  assert.match(text, /Official Build/);
  assert.match(text, /Browser Operator is up to date/, 'Native COM updater must complete its real production HTTPS/CUP check');
  await writeFile(join(artifacts, 'native-update-check.json'), JSON.stringify({passed: true,
    engine: '158.0.8127.18', protocol: 'Omaha over HTTPS with native CUP verification',
    offer: 'noupdate', upgradedTo159: false}, null, 2));
} finally { cdp.close(); }
