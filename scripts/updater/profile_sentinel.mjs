// Create/read a real bookmark through Chromium's privileged Bookmarks WebUI.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {CDP} from '../chromium_cdp.mjs';

const [endpoint, mode, output] = process.argv.slice(2);
assert.ok(endpoint && ['seed', 'check'].includes(mode) && output);
const version = await fetch(`${endpoint}/json/version`).then(r => r.json());
const browser = await CDP.connect(version.webSocketDebuggerUrl);
let page;
try {
  const {targetId} = await browser.send('Target.createTarget', {url: 'chrome://bookmarks/'});
  for (let attempt = 0; attempt < 80; attempt++) {
    const targets = await fetch(`${endpoint}/json/list`).then(r => r.json());
    const target = targets.find(t => t.id === targetId && t.webSocketDebuggerUrl);
    if (target) {
      page = await CDP.connect(target.webSocketDebuggerUrl);
      const {result} = await page.send('Runtime.evaluate', {expression: 'location.href', returnByValue: true});
      if (result.value?.startsWith('chrome://bookmarks/')) break;
      page.close();
      page = undefined;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  assert.ok(page, 'Bookmarks WebUI must load');
  const evaluated = await page.send('Runtime.evaluate', {
    expression: `(async () => {
      const {BookmarksApiProxyImpl, PermanentFolderType} = await import('chrome://bookmarks/bookmarks.js');
      const proxy = BookmarksApiProxyImpl.getInstance();
      const nodes = Object.values(await proxy.getTree());
      const title = 'Browser Operator 158 to 159 preservation test';
      const url = 'https://example.com/browser-operator-update-preservation';
      let bookmark = nodes.find(node => node.title === title && node.url === url);
      if (!bookmark && ${JSON.stringify(mode)} === 'seed') {
        const bar = nodes.find(node => node.permanentFolderType === PermanentFolderType.kBookmarkBar && !node.isSynced);
        if (!bar) throw new Error('Local bookmarks bar not found');
        bookmark = await proxy.create(bar.id, null, title, url);
      }
      if (!bookmark) throw new Error('Preserved bookmark missing');
      return {id: bookmark.id, title: bookmark.title, url: bookmark.url};
    })()`,
    awaitPromise: true, returnByValue: true,
  });
  assert.ok(!evaluated.exceptionDetails, JSON.stringify(evaluated.exceptionDetails));
  assert.ok(evaluated.result.value?.id);
  await mkdir(output, {recursive: true});
  await writeFile(join(output, 'profile-sentinel.json'), JSON.stringify({
    runningVersion: version.Browser, mode, bookmark: evaluated.result.value,
  }, null, 2));
  console.log(`Profile bookmark ${mode}: passed`);
} finally {
  page?.close();
  browser.close();
}
