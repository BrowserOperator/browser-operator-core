// Run this source through Codex's cua_repl in an unlocked macOS GUI session.
// The CLI verification scripts remain authoritative for native update checks.
// Supply releaseToolbarOptions when testing another reviewed release.
{
  const options = typeof releaseToolbarOptions === 'undefined' ? {
    app: '/Applications/Browser Operator.app', version: '159.0.8154.13', productVersion: '0.7.0',
  } : releaseToolbarOptions;
  const app = await cua.getApp(options.app);
  const observations = [];
  async function observe(label) {
    const state = await app.getAXState({disableDiffing: true});
    observations.push({label, state});
    return state;
  }
  function requireText(state, text) {
    if (!state.includes(text)) throw new Error('Missing UI evidence: ' + text);
  }
  function button(state, name) {
    const line = state.split('\n').find(line => line.trim().replace(/^\d+ /, '') === 'button ' + name);
    if (!line) throw new Error('Missing button: ' + name);
    return Number(line.trim().match(/^\d+/)[0]);
  }
  let state = await observe('initial');
  // Restrict this flow to the test guest window, never an everyday profile/tab.
  requireText(state, 'Browser Operator (Guest)');
  if (!state.includes('URL: about:blank') && !state.includes('URL: chrome://settings/help')) {
    throw new Error('Open a blank test guest window before running the toolbar check');
  }
  if (state.includes('container AI Assistant panel')) {
    await app.click(button(state, 'Close Chat Window'));
    state = await observe('reset-closed');
  }
  await app.click(button(state, 'AI Assistant'));
  state = await observe('opened');
  requireText(state, 'container AI Assistant panel');
  if (state.split('\n').some(line => /^\s*\d+ button Skip$/.test(line))) {
    await app.click(button(state, 'Skip'));
    state = await observe('welcome-dismissed');
  }
  requireText(state, 'Browser Operator  ' + options.productVersion);
  button(state, 'Check for updates');
  await app.click(button(state, 'Close Chat Window'));
  state = await observe('closed');
  if (state.includes('container AI Assistant panel')) throw new Error('AI panel did not close');
  await app.click(button(state, 'AI Assistant'));
  state = await observe('reopened');
  requireText(state, 'container AI Assistant panel');
  requireText(state, 'Browser Operator  ' + options.productVersion);
  await app.click(button(state, 'Check for updates'));
  state = await observe('native-about-opened');
  requireText(state, 'Value: chrome://settings/help');
  requireText(state, 'Version ' + options.version + ' (Official Build)');
  await app.getScreenshot();
  nodeRepl.write({schema: 1, passed: true, app: options.app, version: options.version,
    productVersion: options.productVersion, checks: ['toolbar-open','panel-close','toolbar-reopen','native-update-banner'],
    nativeUpdateCheck: 'verified separately by verify_browser_updater.mjs', observations});
}
