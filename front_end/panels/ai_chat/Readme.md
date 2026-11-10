# AI Chat Panel

This panel is a Multi-Agent Framework that allows a user to connect an existing LLM with the chromium browser.

### Develop with a local Chromium fork (macOS)

With a synced Chromium checkout at `~/chromium/src`, install frontend dependencies
and start the development browser from the repository root:

```sh
npm install --legacy-peer-deps --package-lock=false --registry=https://registry.npmjs.org
npm run chromium:dev
```

The launcher reuses Chromium's local GN, Ninja, Node, and esbuild tools. It builds
the unbundled frontend, serves it at `http://127.0.0.1:8000/`, and opens DevTools
in a separate development profile at `out/browser-operator-profile`. Select the
**AI Assistant** panel and configure your model provider in its settings.

Compiled Browser Operator or Chromium apps under `~/chromium/src/out/{BrowserOperator,Default,Release,Debug}`
are preferred. If none exists, the launcher uses an installed Browser Operator,
Chromium, or Chrome app and prints the chosen executable. It does not compile
the Chromium browser itself or replace the fork's bundled DevTools source.

```sh
# Use a specific compiled fork and checkout.
npm run chromium:dev -- --chromium-src /path/to/chromium/src \
  --browser '/path/to/Chromium.app/Contents/MacOS/Chromium'

# Reopen the existing frontend build; rebuild after changing source files.
npm run chromium:dev -- --skip-build

# Build without opening a browser, optionally with full TypeScript checking.
npm run chromium:dev -- --build-only
npm run chromium:dev -- --build-only --typecheck
```

The default development build transpiles with esbuild and skips TypeScript
checking, matching Chromium's development default. Resource manifest checks
still run. Use `--port` and `--debug-port` to avoid local port conflicts.
Remote debugging binds to loopback. Stop the launcher with Ctrl+C to close its
browser and server. A first launch may show a macOS Keychain prompt.

### Docker
```sh
# assuming you are running from the root "browser-operator-core" directory
docker build -f docker/Dockerfile -t devtools-frontend .
docker run -d -p 8000:8000 --name devtools-frontend devtools-frontend
<path-to-devtools-frontend>/third_party/chrome/chrome-<platform>/chrome --disable-infobars --custom-devtools-frontend=http://localhost:8000/

# MacOS Example
/Applications/Google\ Chrome\ Canary.app/Contents/MacOS/Google\ Chrome\ Canary --custom-devtools-frontend=http://localhost:8000/
```


### Steps to run project

1. Setup the depot_tools to fetch the chromium dev tools using the instructions provided [here](https://www.chromium.org/developers/how-tos/get-the-code/)
```sh
git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
export PATH="$PATH:/path/to/depot_tools"
```
2. Follow this instructions to [set up](https://chromium.googlesource.com/devtools/devtools-frontend/+/main/docs/get_the_code.md) dev tools

```sh
# fetching code
mkdir devtools
cd devtools
fetch devtools-frontend

# Build steps
cd devtools-frontend
gclient sync
cd devtools-frontend
npm run build
```

3. Update the code to this fork implementation
```sh
git remote add upstream https://github.com/BrowserOperator/browser-operator-core.git
git fetch upstream
git checkout upstream/main
```

4. Use this to run the [code](https://github.com/tysonthomas9/browser-operator-devtools-frontend/blob/main/front_end/panels/ai_chat/Readme.md)
```sh
npm run build
python -m http.server
```

5. Run Chrome or Chromium Browser instance
```sh
<path-to-devtools-frontend>/third_party/chrome/chrome-<platform>/chrome --disable-infobars --custom-devtools-frontend=http://localhost:8000/

# MacOS Example
/Applications/Google\ Chrome\ Canary.app/Contents/MacOS/Google\ Chrome\ Canary --custom-devtools-frontend=http://localhost:8000/
```

### Setup and Development

1. Build the project and use watch mode
```sh
npm run build -- --watch
```

2. Serve the content of out/Default/gen/front_end on a web server, e.g. via python -m http.server.

```sh
cd out/Default/gen/front_end

python3 -m http.server
```

3. Use the AI Chat panel.

```sh
<path-to-devtools-frontend>/third_party/chrome/chrome-<platform>/chrome --disable-infobars --custom-devtools-frontend=http://localhost:8000/
```


### Agent Architecture

The AI Chat Panel uses the multi-agent framework with the following components:

1. **State Management**: Tracks conversation history, user context, and DevTools state
2. **Tools**: Provides capabilities for DOM inspection, network analysis, and code execution
3. **Workflow**: Defines the agent's reasoning process and decision-making flow

## Reference
https://chromium.googlesource.com/devtools/devtools-frontend/+/main/docs/get_the_code.md#Standalone-checkout-Checking-out-source
