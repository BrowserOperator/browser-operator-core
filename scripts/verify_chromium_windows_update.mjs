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
    // Settings renders inside shadow roots. Use the rendered accessibility
    // tree instead of reading innerText from DocumentFragment shadow roots.
    const tree = await cdp.send('Accessibility.getFullAXTree');
    text = tree.nodes.filter(node => !node.ignored)
      .map(node => node.name?.value ?? '').filter(Boolean).join('\n');
    await writeFile(join(artifacts, 'native-about-ax.json'), JSON.stringify(tree, null, 2));
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
  const version = await fetch(`${endpoint}/json/version`).then(r => r.json());
  const browser = await CDP.connect(version.webSocketDebuggerUrl);
  let nativeResult;
  try {
    for (let n = 0; n < 50; n++) {
      const {histograms} = await browser.send('Browser.getHistograms', {
        query: 'GoogleUpdate.UpgradeResult', delta: false,
      });
      nativeResult = histograms.find(h => h.name === 'GoogleUpdate.UpgradeResult');
      if (nativeResult?.buckets.some(bucket => bucket.low === 4 && bucket.count > 0)) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } finally { browser.close(); }
  await writeFile(join(artifacts, 'native-update-result-histogram.json'), JSON.stringify(nativeResult ?? null, null, 2));
  assert.ok(nativeResult?.buckets.some(bucket => bucket.low === 4 && bucket.count > 0),
    'Native UpdateCheckDriver must report UPGRADE_ALREADY_UP_TO_DATE (4); the basic UI stub does not');
  await writeFile(join(artifacts, 'native-update-check.json'), JSON.stringify({passed: true,
    nativeUpgradeResult: 4, visibleStatus: 'Browser Operator is up to date',
    engine: '158.0.8127.18', protocol: 'Omaha over HTTPS with native CUP verification',
    offer: 'noupdate', upgradedTo159: false}, null, 2));
} finally { cdp.close(); }
