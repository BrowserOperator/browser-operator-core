import assert from 'node:assert/strict';
import {after, beforeEach, test} from 'node:test';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const directory = await mkdtemp(join(tmpdir(), 'bo-version-check-'));
await writeFile(join(directory, 'package.json'), '{"type":"module"}');
for (const name of ['VersionChecker', 'Version']) {
  const source = await readFile(new URL(`../../front_end/panels/ai_chat/core/${name}.ts`, import.meta.url), 'utf8');
  const result = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022}});
  await writeFile(join(directory, name + '.js'), result.outputText);
}
await writeFile(join(directory, 'Logger.js'), 'export const createLogger = () => ({info(){},error(){}});');
const {VersionChecker} = await import(pathToFileURL(join(directory, 'VersionChecker.js')).href);
const originalFetch = globalThis.fetch;
const originalStorage = globalThis.localStorage;
const values = new Map();
globalThis.localStorage = {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
const checker = VersionChecker.getInstance();
const latestURL = 'https://api.github.com/repos/BrowserOperator/browser-operator-core/releases/latest';
let calls;
beforeEach(() => {
  values.clear(); calls = 0; checker.setCurrentVersion('0.5.0');
  globalThis.fetch = async url => {
    calls++; assert.equal(url, latestURL);
    return {ok: true, json: async () => ({tag_name: 'v0.7.0', html_url: 'https://github.com/BrowserOperator/browser-operator-core/releases/tag/v0.7.0'})};
  };
});
after(async () => {
  globalThis.fetch = originalFetch;
  if (originalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalStorage;
  await rm(directory, {recursive: true});
});
for (const version of ['0.5.0', '0.6.0']) {
  test(`${version} users see the public 0.7.0 migration release`, async () => {
    checker.setCurrentVersion(version);
    const result = await checker.checkForUpdates();
    assert.equal(result.latestVersion, '0.7.0');
    assert.equal(result.isUpdateAvailable, true);
    assert.match(result.releaseUrl, /\/v0\.7\.0$/);
  });
}
test('dismissing 0.6.0 does not dismiss 0.7.0', async () => {
  values.set('devtools-version-check-dismissed', '0.6.0');
  const result = await checker.checkForUpdates();
  assert.equal(checker.isUpdateDismissed(result.latestVersion), false);
});
test('legacy daily refresh replaces an old cached 0.6.0 notice', async () => {
  values.set('devtools-version-check-info', JSON.stringify({currentVersion: '0.5.0', latestVersion: '0.6.0', isUpdateAvailable: true}));
  values.set('devtools-version-check-last-check', String(Date.now() - 25 * 60 * 60 * 1000));
  assert.equal((await checker.checkForUpdates()).latestVersion, '0.7.0');
  assert.equal(calls, 1);
});
test('an installed 0.7.0 frontend is not told to download itself', async () => {
  checker.setCurrentVersion('0.7.0');
  assert.equal((await checker.checkForUpdates()).isUpdateAvailable, false);
});
