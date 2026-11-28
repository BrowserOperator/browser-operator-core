// Run this source through Codex's cua_repl in an unlocked macOS GUI session.
// The CLI verification scripts remain authoritative for native update checks.
// Supply releaseToolbarOptions when testing another reviewed release.
{
  const options = typeof releaseToolbarOptions === 'undefined' ? {
    app: '/Applications/Browser Operator.app', version: '159.0.8154.13', productVersion: '0.7.0',
  } : releaseToolbarOptions;
  const app = await cua.getApp(options.app);
  const observations = [];
  async function observe(label, expected) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const state = await app.getAXState({disableDiffing: true});
      requireGuestWindow(state);
      observations.push({label, attempt, state});
      if (!expected || expected(state)) return state;
      // A rendering observation provides missing transition context, without
      // reusing old indexes or adding an arbitrary startup delay.
      await app.getScreenshot();
    }
    throw new Error('UI transition did not complete: ' + label);
  }
  function requireText(state, text) {
    if (!state.includes(text)) throw new Error('Missing UI evidence: ' + text);
  }
  function button(state, name) {
    const line = state.split('\n').find(line => line.trim().replace(/^\d+ /, '') === 'button ' + name);
    if (!line) throw new Error('Missing button: ' + name);
    return Number(line.trim().match(/^\d+/)[0]);
  }
  function requireGuestWindow(state) {
    const windows = state.split('\n').filter(line => /^\d+ standard window /.test(line));
    if (windows.length !== 1 || !windows[0].includes('Browser Operator (Guest)')) {
      throw new Error('Expected exactly one inspected Guest window');
    }
  }
  let state = await observe('initial');
  // Restrict this flow to the test guest window, never an everyday profile/tab.
  requireGuestWindow(state);
  if (!state.includes('URL: about:blank') && !state.includes('URL: chrome://settings/help')) {
    throw new Error('Open a blank test guest window before running the toolbar check');
  }
  if (state.includes('container AI Assistant panel')) {
    await app.click(button(state, 'Close Chat Window'));
    state = await observe('reset-closed', state => !state.includes('container AI Assistant panel'));
  }
  await app.click(button(state, 'AI Assistant'));
  state = await observe('opened', state => state.includes('container AI Assistant panel'));
  requireText(state, 'container AI Assistant panel');
  if (state.split('\n').some(line => /^\s*\d+ button Skip$/.test(line))) {
    await app.click(button(state, 'Skip'));
    state = await observe('welcome-dismissed', state => state.includes('Browser Operator  ' + options.productVersion));
  }
  requireText(state, 'Browser Operator  ' + options.productVersion);
  button(state, 'Check for updates');
  await app.click(button(state, 'Close Chat Window'));
  state = await observe('closed', state => !state.includes('container AI Assistant panel'));
  if (state.includes('container AI Assistant panel')) throw new Error('AI panel did not close');
  await app.click(button(state, 'AI Assistant'));
  state = await observe('reopened', state => state.includes('container AI Assistant panel'));
  requireText(state, 'container AI Assistant panel');
  requireText(state, 'Browser Operator  ' + options.productVersion);
  await app.click(button(state, 'Check for updates'));
  state = await observe('native-about-opened', state => state.includes('Version ' + options.version + ' (Official Build)'));
  requireGuestWindow(state);
  requireText(state, 'Value: chrome://settings/help');
  requireText(state, 'Version ' + options.version + ' (Official Build)');
  await app.getScreenshot();
  nodeRepl.write({schema: 1, passed: true, app: options.app, version: options.version,
    productVersion: options.productVersion, checks: ['toolbar-open','panel-close','toolbar-reopen','native-update-banner'],
    nativeUpdateCheck: 'verified separately by verify_browser_updater.mjs', observations});
}
