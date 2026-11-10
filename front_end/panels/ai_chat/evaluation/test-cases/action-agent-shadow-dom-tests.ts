// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type {TestCase} from '../framework/types.js';

export interface ActionAgentArgs {
  objective: string;
  reasoning: string;
  hint?: string;
  input_data?: string;
}

// ============================================================================
// Shadow DOM Action Tests
// Tests for interacting with elements inside shadow DOM (open and closed)
// ============================================================================

/**
 * Test clicking a button inside an open shadow root.
 * Uses MDN's official web components example.
 */
export const shadowClickOpenTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-shadow-001',
  name: 'Click button in open shadow root',
  description: 'Click a button inside an open shadow DOM on MDN web components example',
  url: 'https://mdn.github.io/web-components-examples/popup-info-box-web-component/',
  tool: 'action_agent',
  input: {
    objective: 'Click the info icon (i button) next to one of the form labels to show the popup information',
    reasoning: 'Testing ability to target and click elements within open shadow DOM',
    hint: 'The info icons are inside <popup-info> custom elements with open shadow roots. Click one to reveal its popup.',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Successfully located an info icon button inside the open shadow root',
        'Used appropriate targeting method (EncodedId, XPath, or CSS with shadow piercing)',
        'Button click was executed successfully',
        'Popup information appeared after clicking',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify the info icon inside the shadow DOM was clicked',
          'Check if the popup information box appeared',
          'Confirm the visual change after clicking',
        ],
      },
    },
  },
  metadata: {
    tags: ['action', 'shadow-dom', 'click', 'open-shadow', 'mdn'],
  },
};

/**
 * Test clicking a button inside a closed shadow root.
 * This requires the shadow piercer to be injected.
 * Uses a local fixture file since closed shadow DOM is rare in public sites.
 */
export const shadowClickClosedTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-shadow-002',
  name: 'Click button in closed shadow root',
  description: 'Click a button inside a closed shadow DOM using shadow piercer',
  url: 'fixture://shadow-dom-closed.html',
  tool: 'action_agent',
  input: {
    objective: 'Click the "Closed Button" that is inside a closed shadow root',
    reasoning: 'Testing shadow piercer capability to access closed shadow DOM elements',
    hint: 'The button is inside a custom <closed-shadow-element> with mode: "closed". The shadow piercer should enable access.',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Successfully located the button inside the closed shadow root',
        'Shadow piercer was properly utilized for resolution',
        'Button click was executed successfully and page changed',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify the closed shadow root button was clicked',
          'Confirm the result text shows the button was clicked',
        ],
      },
    },
  },
  metadata: {
    tags: ['action', 'shadow-dom', 'click', 'closed-shadow', 'shadow-piercer', 'fixture'],
  },
};

/**
 * Test clicking a button inside nested shadow roots.
 * Uses Nicepage which has nested web components for its UI.
 */
export const shadowNestedClickTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-shadow-003',
  name: 'Click button in nested shadow roots',
  description: 'Navigate through multiple nested shadow roots to click a button',
  url: 'https://nicepage.com/',
  tool: 'action_agent',
  input: {
    objective: 'Click on any interactive button or link in the hero section of the page',
    reasoning: 'Testing ability to traverse shadow DOM hierarchy in real-world web components',
    hint: 'Nicepage uses web components with shadow DOM. Look for primary CTA buttons in the main content area.',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Successfully navigated the shadow DOM hierarchy',
        'Located an interactive element within the page structure',
        'Click was executed successfully on the target element',
        'No issues with shadow root traversal',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify an interactive button was found and clicked',
          'Confirm the page responded to the click action',
        ],
      },
    },
  },
  metadata: {
    tags: ['action', 'shadow-dom', 'click', 'nested', 'real-world'],
  },
};

/**
 * Test interacting with GitHub web components (real-world shadow DOM).
 */
export const githubSearchShadowTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-shadow-005',
  name: 'GitHub search with shadow DOM',
  description: 'Use GitHub search bar to search for "browser operator" - tests shadow DOM form interaction',
  url: 'https://github.com',
  tool: 'action_agent',
  input: {
    objective: 'Search for "browser operator" using the GitHub search bar',
    reasoning: 'Testing real-world shadow DOM interaction with GitHub search components',
    hint: 'GitHub uses web components with shadow DOM. Find the search input, type "browser operator", and submit the search.',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Located the search input in GitHub navigation',
        'Successfully entered "browser operator" into the search field',
        'Search was submitted (Enter pressed or search button clicked)',
        'Search results page loaded with results for "browser operator"',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify the search input was found and used',
          'Confirm search results are displayed',
          'Check that results relate to "browser operator"',
        ],
      },
    },
  },
  metadata: {
    tags: ['action', 'shadow-dom', 'github', 'real-world', 'search', 'form'],
    timeout: 30000,
  },
};

/**
 * Test interacting with Google's PWA book app which uses web components.
 */
export const shadowCustomSelectTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-shadow-006',
  name: 'Search and click book in PWA',
  description: 'Search for books and click on a result in Google\'s PWA sample book app',
  url: 'https://books-pwakit.appspot.com/',
  tool: 'action_agent',
  input: {
    objective: 'Search for "javascript" in the search box, then click on one of the book results to view its details',
    reasoning: 'Testing web component interaction in a real PWA application with shadow DOM',
    hint: 'First find the search input and type "javascript", press Enter to search. Then click on any book cover or title from the results.',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Found and used the search input inside shadow DOM',
        'Entered "javascript" search term and submitted search',
        'Located book item elements in the search results',
        'Successfully clicked on a book item',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify search was performed',
          'Confirm book results appeared',
          'Check that a book item was clicked',
        ],
      },
    },
  },
  metadata: {
    tags: ['action', 'shadow-dom', 'pwa', 'web-components', 'google', 'search'],
    timeout: 60000,
  },
};

// Export all shadow DOM action tests
export const shadowDOMActionTests = [
  shadowClickOpenTest,
  shadowClickClosedTest,
  shadowNestedClickTest,
  githubSearchShadowTest,
  shadowCustomSelectTest,
];
