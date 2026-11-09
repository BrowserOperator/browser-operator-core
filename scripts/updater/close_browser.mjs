// Close only the disposable browser addressed by its loopback test endpoint.
import {CDP} from '../chromium_cdp.mjs';
const version = await fetch(`${process.argv[2]}/json/version`).then(r => r.json());
const browser = await CDP.connect(version.webSocketDebuggerUrl);
try {
  await browser.send('Browser.close');
} finally {
  browser.close();
}
