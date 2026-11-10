#!/usr/bin/env npx tsx
/**
 * DOM Module CDP Tests
 *
 * Standalone script that tests DOM modules (FrameRegistry, HybridSnapshot, ShadowPiercer)
 * against a real browser using Chrome DevTools Protocol.
 *
 * Usage:
 *   npx tsx scripts/dom-cdp-tests.ts
 *   # or with node native typescript:
 *   node --experimental-strip-types scripts/dom-cdp-tests.ts
 */

import puppeteer, {type Browser, type CDPSession, type Page, type Protocol} from 'puppeteer-core';
import path from 'path';
import {fileURLToPath} from 'url';

// Get dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===========================================================================
// Shadow Piercer Runtime (copied from ShadowPiercer.ts)
// ===========================================================================
const SHADOW_PIERCER_RUNTIME = `
(function() {
  if (window.__browserOperatorInjected) return;

  const state = {
    hostToRoot: new WeakMap(),
    openCount: 0,
    closedCount: 0,
    debug: false
  };

  const composedChildren = (node) => {
    const out = [];
    if (node instanceof Document) {
      if (node.documentElement) out.push(node.documentElement);
      return out;
    }
    if (node instanceof ShadowRoot || node instanceof DocumentFragment) {
      out.push(...Array.from(node.children));
      return out;
    }
    if (node instanceof Element) {
      out.push(...Array.from(node.children));
      const open = node.shadowRoot;
      if (open) out.push(...Array.from(open.children));
      const closed = state.hostToRoot.get(node);
      if (closed && closed !== open) out.push(...Array.from(closed.children));
    }
    return out;
  };

  const composedDescendants = (node) => {
    const out = [];
    const queue = [...composedChildren(node)];
    while (queue.length) {
      const el = queue.shift();
      out.push(el);
      queue.push(...composedChildren(el));
    }
    return out;
  };

  const resolveSimpleXPath = (xp) => {
    const path = String(xp || '').trim().replace(/^xpath=/i, '');
    if (!path) return null;

    const steps = [];
    let i = 0;
    while (i < path.length) {
      let axis = 'child';
      if (path.startsWith('//', i)) {
        axis = 'desc';
        i += 2;
      } else if (path[i] === '/') {
        axis = 'child';
        i += 1;
      }

      const start = i;
      while (i < path.length && path[i] !== '/') i++;
      const raw = path.slice(start, i).trim();
      if (!raw) continue;

      const m = raw.match(/^(.*?)(\\[(\\d+)\\])?$/u);
      const base = (m?.[1] ?? raw).trim();
      const index = m?.[3] ? Math.max(1, Number(m[3])) : null;
      const tag = base === '' ? '*' : base.toLowerCase();
      steps.push({ axis, raw, tag, index });
    }

    let current = [document];
    for (const step of steps) {
      let chosen = null;
      for (const root of current) {
        const pool = step.axis === 'child'
          ? composedChildren(root)
          : composedDescendants(root);
        const matches = pool.filter(el =>
          step.tag === '*' || el.localName === step.tag
        );
        if (!matches.length) continue;

        chosen = step.index != null
          ? matches[step.index - 1] ?? null
          : matches[0];
        if (chosen) break;
      }
      if (!chosen) return null;
      current = [chosen];
    }

    return current[0] ?? null;
  };

  const original = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(init) {
    const mode = init?.mode ?? 'open';
    const root = original.call(this, init);
    try {
      state.hostToRoot.set(this, root);
      if (mode === 'closed') {
        state.closedCount++;
      } else {
        state.openCount++;
      }
    } catch {}
    return root;
  };

  window.__browserOperator__ = {
    getClosedRoot: (host) => state.hostToRoot.get(host),
    stats: () => ({
      installed: true,
      url: location.href,
      isTop: window.top === window,
      open: state.openCount,
      closed: state.closedCount
    }),
    resolveSimpleXPath
  };

  window.__browserOperatorInjected = true;
})();
`;

// ===========================================================================
// Types
// ===========================================================================
interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  data?: unknown;
  duration?: number;
}

interface FrameInfo {
  id: string;
  ordinal: number;
  url: string;
  parentId?: string;
  name?: string;
}

// ===========================================================================
// Helper Functions
// ===========================================================================

/**
 * Collect frames with ordinals using DFS traversal (matching FrameRegistry logic)
 */
function collectFramesWithOrdinals(
  frameTree: Protocol.Page.FrameTree,
  parentId?: string,
  ordinalRef = {value: 0},
): FrameInfo[] {
  const frames: FrameInfo[] = [];

  const frame: FrameInfo = {
    id: frameTree.frame.id,
    ordinal: ordinalRef.value++,
    url: frameTree.frame.url,
    parentId,
    name: frameTree.frame.name,
  };
  frames.push(frame);

  if (frameTree.childFrames) {
    for (const child of frameTree.childFrames) {
      frames.push(...collectFramesWithOrdinals(child, frame.id, ordinalRef));
    }
  }

  return frames;
}

/**
 * Find a node in the DOM tree by tag name
 */
function findNodeByTag(
  node: Protocol.DOM.Node,
  tagName: string,
): Protocol.DOM.Node | null {
  if (node.nodeName === tagName) {
    return node;
  }
  if (node.children) {
    for (const child of node.children) {
      const found = findNodeByTag(child, tagName);
      if (found) return found;
    }
  }
  // Also search shadow roots
  if (node.shadowRoots) {
    for (const shadowRoot of node.shadowRoots) {
      const found = findNodeByTag(shadowRoot, tagName);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Find all shadow roots in a DOM tree
 */
function findShadowRoots(node: Protocol.DOM.Node): Protocol.DOM.Node[] {
  const roots: Protocol.DOM.Node[] = [];

  if (node.shadowRoots) {
    roots.push(...node.shadowRoots);
  }

  if (node.children) {
    for (const child of node.children) {
      roots.push(...findShadowRoots(child));
    }
  }

  return roots;
}

/**
 * Count elements in a DOM tree
 */
function countElements(node: Protocol.DOM.Node): number {
  let count = node.nodeType === 1 ? 1 : 0; // Element nodes only

  if (node.children) {
    for (const child of node.children) {
      count += countElements(child);
    }
  }
  if (node.shadowRoots) {
    for (const sr of node.shadowRoots) {
      count += countElements(sr);
    }
  }

  return count;
}

// ===========================================================================
// Test Cases
// ===========================================================================

async function testShadowPiercer(
  page: Page,
  cdp: CDPSession,
  fixturesPath: string,
): Promise<TestResult> {
  const start = Date.now();
  try {
    // Inject piercer BEFORE navigating
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: SHADOW_PIERCER_RUNTIME,
      runImmediately: true,
    });

    // Navigate to shadow DOM test page
    await page.goto(`file://${fixturesPath}/shadow-dom-test.html`, {
      waitUntil: 'networkidle0',
    });

    // Verify installation
    const result = await cdp.send('Runtime.evaluate', {
      expression: 'window.__browserOperator__?.stats()',
      returnByValue: true,
    });

    const stats = result.result.value as {
      installed: boolean;
      open: number;
      closed: number;
    } | null;

    return {
      name: 'Shadow Piercer Injection',
      passed: stats?.installed === true,
      data: {
        installed: stats?.installed,
        openShadowRoots: stats?.open,
        closedShadowRoots: stats?.closed,
      },
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      name: 'Shadow Piercer Injection',
      passed: false,
      error: String(error),
      duration: Date.now() - start,
    };
  }
}

async function testFrameCollection(
  page: Page,
  cdp: CDPSession,
  fixturesPath: string,
): Promise<TestResult> {
  const start = Date.now();
  try {
    // Navigate to iframe test page
    await page.goto(`file://${fixturesPath}/iframe-test.html`, {
      waitUntil: 'networkidle0',
    });

    // Wait a bit for iframes to fully load
    await new Promise(resolve => setTimeout(resolve, 500));

    // Get frame tree
    const {frameTree} = await cdp.send('Page.getFrameTree');

    // Collect frames with ordinals (DFS)
    const frames = collectFramesWithOrdinals(frameTree);

    // Verify main frame is ordinal 0
    const mainFrameCorrect = frames[0]?.ordinal === 0;

    // Verify we found multiple frames
    const hasMultipleFrames = frames.length > 1;

    return {
      name: 'Frame Collection',
      passed: mainFrameCorrect && hasMultipleFrames,
      data: {
        frameCount: frames.length,
        frames: frames.map(f => ({
          ordinal: f.ordinal,
          url: f.url.length > 50 ? f.url.slice(0, 50) + '...' : f.url,
          name: f.name || '(unnamed)',
        })),
      },
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      name: 'Frame Collection',
      passed: false,
      error: String(error),
      duration: Date.now() - start,
    };
  }
}

async function testAccessibilityTree(
  page: Page,
  cdp: CDPSession,
): Promise<TestResult> {
  const start = Date.now();
  try {
    // Navigate to a simple page
    await page.goto('https://example.com', {waitUntil: 'networkidle0'});

    // Enable accessibility domain
    await cdp.send('Accessibility.enable');

    // Get full AX tree
    const {nodes} = await cdp.send('Accessibility.getFullAXTree');

    // Count different roles
    const roleCounts: Record<string, number> = {};
    for (const node of nodes || []) {
      const role = node.role?.value || 'unknown';
      roleCounts[role] = (roleCounts[role] || 0) + 1;
    }

    return {
      name: 'Accessibility Tree',
      passed: (nodes?.length || 0) > 0,
      data: {
        nodeCount: nodes?.length || 0,
        topRoles: Object.entries(roleCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([role, count]) => `${role}: ${count}`),
      },
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      name: 'Accessibility Tree',
      passed: false,
      error: String(error),
      duration: Date.now() - start,
    };
  }
}

async function testEncodedIdResolution(
  page: Page,
  cdp: CDPSession,
  fixturesPath: string,
): Promise<TestResult> {
  const start = Date.now();
  try {
    // Navigate to iframe test page
    await page.goto(`file://${fixturesPath}/iframe-test.html`, {
      waitUntil: 'networkidle0',
    });

    // Get document with shadow DOM piercing
    const {root} = await cdp.send('DOM.getDocument', {depth: -1, pierce: true});

    // Find a button element
    const button = findNodeByTag(root, 'BUTTON');

    if (!button || !button.backendNodeId) {
      return {
        name: 'EncodedId Resolution',
        passed: false,
        error: 'No button element found',
        duration: Date.now() - start,
      };
    }

    // Create EncodedId (frameOrdinal-backendNodeId)
    const encodedId = `0-${button.backendNodeId}`;

    // Resolve back via DOM.resolveNode
    const resolved = await cdp.send('DOM.resolveNode', {
      backendNodeId: button.backendNodeId,
    });

    return {
      name: 'EncodedId Resolution',
      passed: !!resolved.object?.objectId,
      data: {
        encodedId,
        backendNodeId: button.backendNodeId,
        objectId: resolved.object?.objectId?.slice(0, 30) + '...',
        className: resolved.object?.className,
      },
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      name: 'EncodedId Resolution',
      passed: false,
      error: String(error),
      duration: Date.now() - start,
    };
  }
}

async function testNestedIframes(
  page: Page,
  cdp: CDPSession,
  fixturesPath: string,
): Promise<TestResult> {
  const start = Date.now();
  try {
    // Navigate to iframe test page (has nested iframes)
    await page.goto(`file://${fixturesPath}/iframe-test.html`, {
      waitUntil: 'networkidle0',
    });

    // Wait for iframes
    await new Promise(resolve => setTimeout(resolve, 500));

    // Get frame tree
    const {frameTree} = await cdp.send('Page.getFrameTree');

    // Collect all frames
    const frames = collectFramesWithOrdinals(frameTree);

    // Find the deepest nested frame
    const maxDepth = frames.reduce((max, f) => {
      let depth = 0;
      let current = f;
      while (current.parentId) {
        depth++;
        current = frames.find(fr => fr.id === current.parentId)!;
        if (!current) break;
      }
      return Math.max(max, depth);
    }, 0);

    // Get DOM for the main frame
    const {root} = await cdp.send('DOM.getDocument', {depth: -1, pierce: true});
    const elementCount = countElements(root);

    return {
      name: 'Nested Iframes',
      passed: frames.length >= 2 && maxDepth >= 1,
      data: {
        frameCount: frames.length,
        maxDepth,
        totalElements: elementCount,
        frameHierarchy: frames.map(f => `  ${'  '.repeat(f.ordinal > 0 ? 1 : 0)}[${f.ordinal}] ${f.name || 'main'}`).join('\n'),
      },
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      name: 'Nested Iframes',
      passed: false,
      error: String(error),
      duration: Date.now() - start,
    };
  }
}

async function testShadowDOMElements(
  page: Page,
  cdp: CDPSession,
  fixturesPath: string,
): Promise<TestResult> {
  const start = Date.now();
  try {
    // Inject piercer first
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: SHADOW_PIERCER_RUNTIME,
      runImmediately: true,
    });

    // Navigate to shadow DOM test page
    await page.goto(`file://${fixturesPath}/shadow-dom-test.html`, {
      waitUntil: 'networkidle0',
    });

    // Get document with pierce option
    const {root} = await cdp.send('DOM.getDocument', {depth: -1, pierce: true});

    // Find shadow roots in the DOM
    const shadowRoots = findShadowRoots(root);

    // Get piercer stats (includes closed shadow roots)
    const statsResult = await cdp.send('Runtime.evaluate', {
      expression: 'window.__browserOperator__?.stats()',
      returnByValue: true,
    });

    const stats = statsResult.result.value as {
      open: number;
      closed: number;
    } | null;

    // Try to access closed shadow root via piercer
    const closedAccessResult = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          const host = document.querySelector('closed-shadow-host');
          if (!host) return { found: false, reason: 'host not found' };
          const root = window.__browserOperator__?.getClosedRoot(host);
          if (!root) return { found: false, reason: 'piercer returned null' };
          const btn = root.querySelector('button');
          return { found: true, buttonText: btn?.textContent };
        })()
      `,
      returnByValue: true,
    });

    const closedAccess = closedAccessResult.result.value as {
      found: boolean;
      buttonText?: string;
      reason?: string;
    };

    return {
      name: 'Shadow DOM Access',
      passed: shadowRoots.length > 0 && closedAccess.found,
      data: {
        shadowRootsInDOM: shadowRoots.length,
        openShadowRoots: stats?.open || 0,
        closedShadowRoots: stats?.closed || 0,
        closedAccessible: closedAccess.found,
        closedButtonText: closedAccess.buttonText || closedAccess.reason,
      },
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      name: 'Shadow DOM Access',
      passed: false,
      error: String(error),
      duration: Date.now() - start,
    };
  }
}

async function testXPathResolution(
  page: Page,
  cdp: CDPSession,
  fixturesPath: string,
): Promise<TestResult> {
  const start = Date.now();
  try {
    // Inject piercer
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: SHADOW_PIERCER_RUNTIME,
      runImmediately: true,
    });

    // Navigate
    await page.goto(`file://${fixturesPath}/shadow-dom-test.html`, {
      waitUntil: 'networkidle0',
    });

    // Test XPath resolution through shadow DOM via piercer
    const xpathResult = await cdp.send('Runtime.evaluate', {
      expression: `
        (function() {
          // Try to find button inside closed shadow DOM
          const result = window.__browserOperator__?.resolveSimpleXPath('//closed-shadow-host//button');
          if (!result) return { found: false };
          return { found: true, tagName: result.tagName, text: result.textContent };
        })()
      `,
      returnByValue: true,
    });

    const xpath = xpathResult.result.value as {
      found: boolean;
      tagName?: string;
      text?: string;
    };

    return {
      name: 'XPath Resolution Through Shadow DOM',
      passed: xpath.found,
      data: {
        xpath: '//closed-shadow-host//button',
        found: xpath.found,
        tagName: xpath.tagName,
        text: xpath.text,
      },
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      name: 'XPath Resolution Through Shadow DOM',
      passed: false,
      error: String(error),
      duration: Date.now() - start,
    };
  }
}

// ===========================================================================
// Real Website Tests
// ===========================================================================

async function testJQuerySlider(
  page: Page,
  cdp: CDPSession,
): Promise<TestResult> {
  const start = Date.now();
  const fs = await import('fs');
  const screenshotDir = path.resolve(__dirname, '../test-screenshots');

  // Create screenshot directory if it doesn't exist
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, {recursive: true});
  }

  try {
    // Navigate to jQuery UI slider demo
    await page.goto('https://jqueryui.com/resources/demos/slider/default.html', {
      waitUntil: 'networkidle0',
    });

    // Wait for slider to initialize
    await new Promise(resolve => setTimeout(resolve, 500));

    // Take BEFORE screenshot
    const beforePath = path.join(screenshotDir, 'slider-before.png');
    await page.screenshot({path: beforePath, fullPage: false});
    console.log(`  📸 Before screenshot: ${beforePath}`);

    // Get the slider handle element
    const handle = await page.$('.ui-slider-handle');
    if (!handle) {
      return {
        name: 'jQuery UI Slider',
        passed: false,
        error: 'Slider handle not found',
        duration: Date.now() - start,
      };
    }

    const handleBox = await handle.boundingBox();
    if (!handleBox) {
      return {
        name: 'jQuery UI Slider',
        passed: false,
        error: 'Could not get handle bounding box',
        duration: Date.now() - start,
      };
    }

    // Get initial position
    const initialLeft = handleBox.x;

    // Simulate drag to the right using Input.dispatchMouseEvent
    const centerX = handleBox.x + handleBox.width / 2;
    const centerY = handleBox.y + handleBox.height / 2;

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: centerX,
      y: centerY,
      button: 'left',
      clickCount: 1,
    });

    // Move 100px to the right
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: centerX + 100,
      y: centerY,
      button: 'left',
    });

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: centerX + 100,
      y: centerY,
      button: 'left',
      clickCount: 1,
    });

    // Wait for animation
    await new Promise(resolve => setTimeout(resolve, 200));

    // Take AFTER screenshot
    const afterPath = path.join(screenshotDir, 'slider-after.png');
    await page.screenshot({path: afterPath, fullPage: false});
    console.log(`  📸 After screenshot: ${afterPath}`);

    // Verify position changed
    const newBox = await handle.boundingBox();
    const moved = newBox && newBox.x > initialLeft;
    const movedBy = newBox ? Math.round(newBox.x - initialLeft) : 0;

    return {
      name: 'jQuery UI Slider',
      passed: !!moved,
      data: {
        initialX: Math.round(initialLeft),
        newX: newBox ? Math.round(newBox.x) : 'unknown',
        movedBy: movedBy,
        screenshots: {
          before: beforePath,
          after: afterPath,
        },
      },
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      name: 'jQuery UI Slider',
      passed: false,
      error: String(error),
      duration: Date.now() - start,
    };
  }
}

async function testJQuerySliderIframe(
  page: Page,
  cdp: CDPSession,
): Promise<TestResult> {
  const start = Date.now();
  const fs = await import('fs');
  const screenshotDir = path.resolve(__dirname, '../test-screenshots');

  // Create screenshot directory if it doesn't exist
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, {recursive: true});
  }

  try {
    // Navigate to jQuery UI slider page (with iframe)
    await page.goto('https://jqueryui.com/slider/', {
      waitUntil: 'networkidle0',
    });

    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 500));

    // Take BEFORE screenshot
    const beforePath = path.join(screenshotDir, 'slider-iframe-before.png');
    await page.screenshot({path: beforePath, fullPage: false});
    console.log(`  📸 Before screenshot: ${beforePath}`);

    // Find the demo iframe
    const iframeElement = await page.$('iframe.demo-frame');
    if (!iframeElement) {
      return {
        name: 'jQuery UI Slider (Iframe)',
        passed: false,
        error: 'Demo iframe not found (no iframe.demo-frame)',
        duration: Date.now() - start,
      };
    }

    // Get iframe content frame
    const iframe = await iframeElement.contentFrame();
    if (!iframe) {
      return {
        name: 'jQuery UI Slider (Iframe)',
        passed: false,
        error: 'Could not access iframe content frame',
        duration: Date.now() - start,
      };
    }

    // Wait for slider to initialize inside iframe
    await new Promise(resolve => setTimeout(resolve, 500));

    // Get the slider handle element inside iframe
    const handle = await iframe.$('.ui-slider-handle');
    if (!handle) {
      return {
        name: 'jQuery UI Slider (Iframe)',
        passed: false,
        error: 'Slider handle not found inside iframe',
        duration: Date.now() - start,
      };
    }

    const handleBox = await handle.boundingBox();
    if (!handleBox) {
      return {
        name: 'jQuery UI Slider (Iframe)',
        passed: false,
        error: 'Could not get handle bounding box',
        duration: Date.now() - start,
      };
    }

    // Get initial position
    const initialLeft = handleBox.x;

    // Simulate drag to the right using Input.dispatchMouseEvent
    // Note: coordinates are relative to the main page, not the iframe
    const centerX = handleBox.x + handleBox.width / 2;
    const centerY = handleBox.y + handleBox.height / 2;

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: centerX,
      y: centerY,
      button: 'left',
      clickCount: 1,
    });

    // Move in steps for smoother dragging
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: centerX + (100 * i) / steps,
        y: centerY,
        button: 'left',
      });
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: centerX + 100,
      y: centerY,
      button: 'left',
      clickCount: 1,
    });

    // Wait for animation
    await new Promise(resolve => setTimeout(resolve, 200));

    // Take AFTER screenshot
    const afterPath = path.join(screenshotDir, 'slider-iframe-after.png');
    await page.screenshot({path: afterPath, fullPage: false});
    console.log(`  📸 After screenshot: ${afterPath}`);

    // Verify position changed
    const newBox = await handle.boundingBox();
    const moved = newBox && newBox.x > initialLeft;
    const movedBy = newBox ? Math.round(newBox.x - initialLeft) : 0;

    return {
      name: 'jQuery UI Slider (Iframe)',
      passed: !!moved,
      data: {
        initialX: Math.round(initialLeft),
        newX: newBox ? Math.round(newBox.x) : 'unknown',
        movedBy: movedBy,
        iframeTest: true,
        screenshots: {
          before: beforePath,
          after: afterPath,
        },
      },
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      name: 'jQuery UI Slider (Iframe)',
      passed: false,
      error: String(error),
      duration: Date.now() - start,
    };
  }
}

async function testGitHubAnalysis(
  page: Page,
  cdp: CDPSession,
): Promise<TestResult> {
  const start = Date.now();
  try {
    // Navigate to GitHub
    await page.goto('https://github.com', {
      waitUntil: 'networkidle0',
    });

    // Enable accessibility domain
    await cdp.send('Accessibility.enable');

    // Get full AX tree
    const {nodes} = await cdp.send('Accessibility.getFullAXTree');

    // Find buttons
    const buttons = (nodes || []).filter(
      n => n.role?.value === 'button' && n.name?.value,
    );

    // Find links
    const links = (nodes || []).filter(n => n.role?.value === 'link');

    // Get DOM tree
    const {root} = await cdp.send('DOM.getDocument', {depth: -1});
    const elementCount = countElements(root);

    return {
      name: 'GitHub Page Analysis',
      passed: buttons.length > 0 && links.length > 0,
      data: {
        axNodes: nodes?.length || 0,
        buttons: buttons.length,
        links: links.length,
        elements: elementCount,
        sampleButtons: buttons
          .slice(0, 3)
          .map(b => b.name?.value || '(unnamed)'),
      },
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      name: 'GitHub Page Analysis',
      passed: false,
      error: String(error),
      duration: Date.now() - start,
    };
  }
}

async function testGoogleSearchInput(
  page: Page,
  cdp: CDPSession,
): Promise<TestResult> {
  const start = Date.now();
  try {
    // Navigate to Google
    await page.goto('https://www.google.com', {
      waitUntil: 'networkidle0',
    });

    // Enable accessibility domain
    await cdp.send('Accessibility.enable');

    // Get full AX tree
    const {nodes} = await cdp.send('Accessibility.getFullAXTree');

    // Find search input via accessibility tree
    const searchBox = (nodes || []).find(
      n =>
        n.role?.value === 'combobox' ||
        n.role?.value === 'searchbox' ||
        n.role?.value === 'textbox',
    );

    let typedText = false;

    if (searchBox?.backendDOMNodeId) {
      // Resolve to runtime object
      const resolved = await cdp.send('DOM.resolveNode', {
        backendNodeId: searchBox.backendDOMNodeId,
      });

      if (resolved.object?.objectId) {
        // Focus the element
        await cdp.send('Runtime.callFunctionOn', {
          objectId: resolved.object.objectId,
          functionDeclaration: 'function() { this.focus(); }',
        });

        // Type using Input domain
        await cdp.send('Input.insertText', {text: 'CDP test query'});

        // Verify text was typed
        const valueResult = await cdp.send('Runtime.callFunctionOn', {
          objectId: resolved.object.objectId,
          functionDeclaration: 'function() { return this.value; }',
          returnByValue: true,
        });

        typedText = valueResult.result?.value === 'CDP test query';
      }
    }

    return {
      name: 'Google Search Input',
      passed: !!searchBox && typedText,
      data: {
        foundSearchBox: !!searchBox,
        searchBoxRole: searchBox?.role?.value,
        typedSuccessfully: typedText,
      },
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      name: 'Google Search Input',
      passed: false,
      error: String(error),
      duration: Date.now() - start,
    };
  }
}

async function testWikipediaDOM(
  page: Page,
  cdp: CDPSession,
): Promise<TestResult> {
  const start = Date.now();
  try {
    // Navigate to Wikipedia
    await page.goto('https://en.wikipedia.org/wiki/Main_Page', {
      waitUntil: 'networkidle0',
    });

    // Get full DOM tree
    const {root} = await cdp.send('DOM.getDocument', {depth: -1});
    const elementCount = countElements(root);

    // Enable accessibility domain
    await cdp.send('Accessibility.enable');

    // Get full AX tree
    const {nodes} = await cdp.send('Accessibility.getFullAXTree');

    // Count different types
    const links = (nodes || []).filter(n => n.role?.value === 'link');
    const headings = (nodes || []).filter(n => n.role?.value === 'heading');
    const images = (nodes || []).filter(n => n.role?.value === 'image');

    return {
      name: 'Wikipedia DOM Analysis',
      passed: elementCount > 100 && links.length > 50,
      data: {
        elements: elementCount,
        axNodes: nodes?.length || 0,
        links: links.length,
        headings: headings.length,
        images: images.length,
      },
      duration: Date.now() - start,
    };
  } catch (error) {
    return {
      name: 'Wikipedia DOM Analysis',
      passed: false,
      error: String(error),
      duration: Date.now() - start,
    };
  }
}

// ===========================================================================
// Test Runner
// ===========================================================================

function printResults(results: TestResult[]): void {
  console.log('\n' + '='.repeat(60));
  console.log('DOM Module CDP Tests');
  console.log('='.repeat(60) + '\n');

  let passed = 0;
  let failed = 0;

  for (const result of results) {
    const icon = result.passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
    const duration = result.duration ? ` (${result.duration}ms)` : '';

    console.log(`${icon} ${result.name}${duration}`);

    if (result.error) {
      console.log(`  \x1b[31m└─ Error: ${result.error}\x1b[0m`);
    } else if (result.data) {
      const dataStr = typeof result.data === 'object'
        ? JSON.stringify(result.data, null, 2).split('\n').map(l => `  │ ${l}`).join('\n')
        : `  │ ${result.data}`;
      console.log(`  └─ Data:\n${dataStr}`);
    }
    console.log();

    if (result.passed) passed++;
    else failed++;
  }

  console.log('='.repeat(60));
  const color = failed === 0 ? '\x1b[32m' : '\x1b[31m';
  console.log(`${color}Results: ${passed}/${results.length} passed\x1b[0m`);
  console.log('='.repeat(60) + '\n');
}

async function findChrome(): Promise<string> {
  const possiblePaths = [
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];

  const fs = await import('fs');
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  throw new Error(
    'Chrome not found. Please install Chrome or set CHROME_PATH environment variable.',
  );
}

async function main(): Promise<void> {
  console.log('\n🚀 Starting DOM CDP Tests...\n');

  // Find Chrome
  const chromePath = process.env.CHROME_PATH || (await findChrome());
  console.log(`Using Chrome: ${chromePath}`);

  // Fixtures path
  const fixturesPath = path.resolve(
    __dirname,
    '../front_end/panels/ai_chat/testing/fixtures',
  );
  console.log(`Fixtures: ${fixturesPath}\n`);

  // Launch browser
  const browser: Browser = await puppeteer.launch({
    headless: false, // Set to true for CI
    executablePath: chromePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security', // Allow file:// access
      '--allow-file-access-from-files',
    ],
  });

  try {
    const page = await browser.newPage();
    const cdp = await page.createCDPSession();

    // Enable required domains
    await cdp.send('DOM.enable');
    await cdp.send('Page.enable');

    // Run tests
    const results: TestResult[] = [];

    results.push(await testShadowPiercer(page, cdp, fixturesPath));

    // Create fresh page for next tests (to avoid piercer state)
    await page.close();
    const page2 = await browser.newPage();
    const cdp2 = await page2.createCDPSession();
    await cdp2.send('DOM.enable');
    await cdp2.send('Page.enable');

    results.push(await testFrameCollection(page2, cdp2, fixturesPath));
    results.push(await testAccessibilityTree(page2, cdp2));
    results.push(await testEncodedIdResolution(page2, cdp2, fixturesPath));
    results.push(await testNestedIframes(page2, cdp2, fixturesPath));

    // Create fresh page for shadow DOM tests
    await page2.close();
    const page3 = await browser.newPage();
    const cdp3 = await page3.createCDPSession();
    await cdp3.send('DOM.enable');
    await cdp3.send('Page.enable');

    results.push(await testShadowDOMElements(page3, cdp3, fixturesPath));
    results.push(await testXPathResolution(page3, cdp3, fixturesPath));

    // Create fresh page for real website tests
    await page3.close();
    const page4 = await browser.newPage();
    const cdp4 = await page4.createCDPSession();
    await cdp4.send('DOM.enable');
    await cdp4.send('Page.enable');

    console.log('\n--- Running Real Website Tests ---\n');

    results.push(await testJQuerySlider(page4, cdp4));
    results.push(await testJQuerySliderIframe(page4, cdp4));
    results.push(await testGitHubAnalysis(page4, cdp4));
    results.push(await testGoogleSearchInput(page4, cdp4));
    results.push(await testWikipediaDOM(page4, cdp4));

    // Print results
    printResults(results);

    // Exit with appropriate code
    const allPassed = results.every(r => r.passed);
    process.exitCode = allPassed ? 0 : 1;
  } finally {
    await browser.close();
  }
}

// Run
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
