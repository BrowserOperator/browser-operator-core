/**
 * DOM Test Cases for CLI Eval Runner
 *
 * These are ported from scripts/dom-cdp-tests.ts to work with
 * the eval runner framework.
 */

import type { TestCase } from '../types.ts';

// Shadow Piercer Runtime Script (injected into pages for TESTING)
// Note: Uses __testShadowPiercer flag to avoid collision with Browser Operator's built-in injection
export const SHADOW_PIERCER_RUNTIME = `
(function() {
  // Use test-specific flag to avoid collision with Browser Operator's built-in shadow piercer
  if (window.__testShadowPiercerInjected) return;

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

        const matches = pool.filter(el => step.tag === '*' || el.tagName?.toLowerCase() === step.tag);
        if (step.index !== null) {
          if (matches[step.index - 1]) {
            chosen = matches[step.index - 1];
            break;
          }
        } else if (matches.length) {
          chosen = matches[0];
          break;
        }
      }
      if (!chosen) return null;
      current = [chosen];
    }
    return current[0] || null;
  };

  const originalAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(init) {
    const root = originalAttachShadow.call(this, init);
    state.hostToRoot.set(this, root);
    if (init.mode === 'closed') state.closedCount++;
    else state.openCount++;
    return root;
  };

  // Set test-specific state (separate from Browser Operator's built-in state)
  window.__browserOperatorState = state;
  window.__browserOperatorResolveXPath = resolveSimpleXPath;
  window.__testShadowPiercerInjected = true;
})();
`;

/**
 * DOM test case interface extending base TestCase
 */
export interface DOMTestCase extends TestCase {
  domTest: {
    type: 'shadow-piercer' | 'frame-collection' | 'accessibility' | 'xpath' | 'slider' | 'page-analysis';
    setup?: string; // HTML to inject or URL to navigate
    assertions: DOMAssertion[];
  };
}

export interface DOMAssertion {
  description: string;
  check: string; // JavaScript expression that returns { passed: boolean, data?: any }
}

// ============================================================================
// Shadow DOM Tests
// ============================================================================

export const shadowPiercerOpenTest: DOMTestCase = {
  id: 'dom-shadow-piercer-open-001',
  name: 'Shadow Piercer - Open Shadow DOM',
  description: 'Test that shadow piercer can access open shadow DOM elements',
  url: 'about:blank',
  tool: 'dom_test',
  input: {},
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Shadow piercer runtime was injected successfully',
        'Open shadow root was created and tracked',
        'Can find button inside open shadow DOM',
      ],
    },
  },
  metadata: {
    tags: ['dom', 'shadow-dom', 'open', 'shadow-piercer'],
    timeout: 30000,
  },
  domTest: {
    type: 'shadow-piercer',
    setup: `
      const host = document.createElement('open-shadow-host');
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<button id="open-btn">Open Button</button>';
      document.body.appendChild(host);
    `,
    assertions: [
      {
        description: 'Shadow piercer is injected',
        check: `({ passed: typeof window.__testShadowPiercerInjected === 'boolean' && window.__testShadowPiercerInjected })`,
      },
      {
        description: 'Open shadow root is tracked',
        check: `({ passed: window.__browserOperatorState?.openCount >= 1, data: { openCount: window.__browserOperatorState?.openCount } })`,
      },
      {
        description: 'Can find button inside open shadow DOM via XPath',
        check: `(() => {
          const el = window.__browserOperatorResolveXPath('//open-shadow-host//button');
          return { passed: el !== null && el.textContent === 'Open Button', data: { found: !!el, text: el?.textContent } };
        })()`,
      },
    ],
  },
};

export const shadowPiercerClosedTest: DOMTestCase = {
  id: 'dom-shadow-piercer-closed-001',
  name: 'Shadow Piercer - Closed Shadow DOM',
  description: 'Test that shadow piercer can access closed shadow DOM elements',
  url: 'about:blank',
  tool: 'dom_test',
  input: {},
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Closed shadow root was created and tracked',
        'Can find button inside closed shadow DOM',
        'Element text content matches expected value',
      ],
    },
  },
  metadata: {
    tags: ['dom', 'shadow-dom', 'closed', 'shadow-piercer'],
    timeout: 30000,
  },
  domTest: {
    type: 'shadow-piercer',
    setup: `
      const host = document.createElement('closed-shadow-host');
      const shadow = host.attachShadow({ mode: 'closed' });
      shadow.innerHTML = '<button id="closed-btn">Closed Button</button>';
      document.body.appendChild(host);
    `,
    assertions: [
      {
        description: 'Closed shadow root is tracked',
        check: `({ passed: window.__browserOperatorState?.closedCount >= 1, data: { closedCount: window.__browserOperatorState?.closedCount } })`,
      },
      {
        description: 'Can find button inside closed shadow DOM via XPath',
        check: `(() => {
          const el = window.__browserOperatorResolveXPath('//closed-shadow-host//button');
          return { passed: el !== null && el.textContent === 'Closed Button', data: { found: !!el, text: el?.textContent } };
        })()`,
      },
    ],
  },
};

export const shadowPiercerNestedTest: DOMTestCase = {
  id: 'dom-shadow-piercer-nested-001',
  name: 'Shadow Piercer - Nested Shadow DOM',
  description: 'Test shadow piercer with nested shadow roots (open inside closed)',
  url: 'about:blank',
  tool: 'dom_test',
  input: {},
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Outer closed shadow root was created',
        'Inner open shadow root was created',
        'XPath can traverse through both shadow boundaries',
      ],
    },
  },
  metadata: {
    tags: ['dom', 'shadow-dom', 'nested', 'shadow-piercer'],
    timeout: 30000,
  },
  domTest: {
    type: 'shadow-piercer',
    setup: `
      const outer = document.createElement('outer-shadow-host');
      const outerShadow = outer.attachShadow({ mode: 'closed' });

      const inner = document.createElement('inner-shadow-host');
      outerShadow.appendChild(inner);

      const innerShadow = inner.attachShadow({ mode: 'open' });
      innerShadow.innerHTML = '<span id="deep-element">Deep Nested</span>';

      document.body.appendChild(outer);
    `,
    assertions: [
      {
        description: 'Both shadow roots are tracked',
        check: `({
          passed: window.__browserOperatorState?.closedCount >= 1 && window.__browserOperatorState?.openCount >= 1,
          data: { closedCount: window.__browserOperatorState?.closedCount, openCount: window.__browserOperatorState?.openCount }
        })`,
      },
      {
        description: 'Can find span through nested shadow DOMs via XPath',
        check: `(() => {
          const el = window.__browserOperatorResolveXPath('//outer-shadow-host//inner-shadow-host//span');
          return { passed: el !== null && el.textContent === 'Deep Nested', data: { found: !!el, text: el?.textContent } };
        })()`,
      },
    ],
  },
};

// ============================================================================
// Iframe Tests
// ============================================================================

export const iframeBasicTest: DOMTestCase = {
  id: 'dom-iframe-basic-001',
  name: 'Iframe - Basic Frame Detection',
  description: 'Test detection of iframes in the page',
  url: 'about:blank',
  tool: 'dom_test',
  input: {},
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Iframe element was created',
        'Frame can be detected via DOM query',
      ],
    },
  },
  metadata: {
    tags: ['dom', 'iframe', 'frame-detection'],
    timeout: 30000,
  },
  domTest: {
    type: 'frame-collection',
    setup: `
      const iframe = document.createElement('iframe');
      iframe.id = 'test-frame';
      iframe.srcdoc = '<html><body><button>Frame Button</button></body></html>';
      document.body.appendChild(iframe);
    `,
    assertions: [
      {
        description: 'Iframe exists in DOM',
        check: `({ passed: document.getElementById('test-frame') !== null })`,
      },
      {
        description: 'Can count frames',
        check: `({ passed: document.querySelectorAll('iframe').length >= 1, data: { frameCount: document.querySelectorAll('iframe').length } })`,
      },
    ],
  },
};

// ============================================================================
// Accessibility Tree Tests
// ============================================================================

export const accessibilityTreeTest: DOMTestCase = {
  id: 'dom-accessibility-001',
  name: 'Accessibility Tree - Basic Structure',
  description: 'Test getting accessibility tree from a page',
  url: 'https://www.google.com',
  tool: 'dom_test',
  input: {},
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Accessibility tree was retrieved successfully',
        'Tree contains interactive elements',
        'Search-related elements are present',
      ],
    },
  },
  metadata: {
    tags: ['dom', 'accessibility', 'a11y'],
    timeout: 45000,
  },
  domTest: {
    type: 'accessibility',
    assertions: [
      {
        description: 'Page has accessibility nodes',
        check: `({ passed: true })`, // Evaluated via CDP
      },
    ],
  },
};

// ============================================================================
// Slider Tests (jQuery UI)
// ============================================================================

export const jquerySliderTest: DOMTestCase = {
  id: 'dom-slider-jquery-001',
  name: 'jQuery UI Slider - Direct Demo',
  description: 'Test dragging jQuery UI slider via CDP mouse events',
  url: 'https://jqueryui.com/resources/demos/slider/default.html',
  tool: 'dom_test',
  input: {},
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Slider handle element was found',
        'Drag operation was performed',
        'Slider position changed after drag',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
      },
    },
  },
  metadata: {
    tags: ['dom', 'slider', 'drag', 'jquery', 'interaction'],
    timeout: 45000,
  },
  domTest: {
    type: 'slider',
    assertions: [
      {
        description: 'Slider handle exists',
        check: `({ passed: document.querySelector('.ui-slider-handle') !== null })`,
      },
    ],
  },
};

export const jquerySliderIframeTest: DOMTestCase = {
  id: 'dom-slider-jquery-iframe-001',
  name: 'jQuery UI Slider - Iframe Demo',
  description: 'Test dragging jQuery UI slider inside an iframe',
  url: 'https://jqueryui.com/slider/',
  tool: 'dom_test',
  input: {},
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Demo iframe was found',
        'Slider handle inside iframe was located',
        'Drag operation worked across iframe boundary',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
      },
    },
  },
  metadata: {
    tags: ['dom', 'slider', 'drag', 'jquery', 'iframe', 'interaction'],
    timeout: 45000,
  },
  domTest: {
    type: 'slider',
    assertions: [
      {
        description: 'Demo iframe exists',
        check: `({ passed: document.querySelector('iframe.demo-frame') !== null })`,
      },
    ],
  },
};

// ============================================================================
// Page Analysis Tests
// ============================================================================

export const githubAnalysisTest: DOMTestCase = {
  id: 'dom-analysis-github-001',
  name: 'Page Analysis - GitHub',
  description: 'Analyze GitHub page structure and accessibility',
  url: 'https://github.com',
  tool: 'dom_test',
  input: {},
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Page loaded successfully',
        'Accessibility tree has nodes',
        'Interactive elements (buttons, links) were found',
      ],
    },
  },
  metadata: {
    tags: ['dom', 'analysis', 'github', 'accessibility'],
    timeout: 45000,
  },
  domTest: {
    type: 'page-analysis',
    assertions: [
      {
        description: 'Page has buttons',
        check: `({ passed: document.querySelectorAll('button').length > 0, data: { buttonCount: document.querySelectorAll('button').length } })`,
      },
      {
        description: 'Page has links',
        check: `({ passed: document.querySelectorAll('a').length > 0, data: { linkCount: document.querySelectorAll('a').length } })`,
      },
    ],
  },
};

export const wikipediaAnalysisTest: DOMTestCase = {
  id: 'dom-analysis-wikipedia-001',
  name: 'Page Analysis - Wikipedia',
  description: 'Analyze Wikipedia page structure',
  url: 'https://www.wikipedia.org',
  tool: 'dom_test',
  input: {},
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Page loaded successfully',
        'Language links are present',
        'Search functionality exists',
      ],
    },
  },
  metadata: {
    tags: ['dom', 'analysis', 'wikipedia'],
    timeout: 45000,
  },
  domTest: {
    type: 'page-analysis',
    assertions: [
      {
        description: 'Has language links',
        check: `({ passed: document.querySelectorAll('a[lang]').length > 0, data: { langLinkCount: document.querySelectorAll('a[lang]').length } })`,
      },
    ],
  },
};

// ============================================================================
// Export all DOM tests
// ============================================================================

export const domTests: DOMTestCase[] = [
  shadowPiercerOpenTest,
  shadowPiercerClosedTest,
  shadowPiercerNestedTest,
  iframeBasicTest,
  accessibilityTreeTest,
  jquerySliderTest,
  jquerySliderIframeTest,
  githubAnalysisTest,
  wikipediaAnalysisTest,
];

export function getDOMTestsByTag(tag: string): DOMTestCase[] {
  return domTests.filter(t => t.metadata.tags.includes(tag));
}

export function getShadowDOMTests(): DOMTestCase[] {
  return getDOMTestsByTag('shadow-dom');
}

export function getSliderTests(): DOMTestCase[] {
  return getDOMTestsByTag('slider');
}
