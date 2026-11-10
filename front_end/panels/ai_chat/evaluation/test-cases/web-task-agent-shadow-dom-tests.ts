// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type {TestCase} from '../framework/types.js';

export interface WebTaskAgentArgs {
  task: string;
  reasoning?: string;
  context?: Record<string, unknown>;
}

// ============================================================================
// Web Task Agent Shadow DOM Tests
// Multi-step workflow tests involving shadow DOM components
// ============================================================================

/**
 * Test interacting with Shoelace web components (real shadow DOM library).
 */
export const shadowDomFormWorkflowTest: TestCase<WebTaskAgentArgs> = {
  id: 'web-task-shadow-001',
  name: 'Interact with Shoelace components',
  description: 'Navigate Shoelace component library and interact with shadow DOM components',
  url: 'https://shoelace.style/components/input',
  tool: 'web_task_agent',
  input: {
    task: 'Navigate to the Shoelace Input component documentation, find the demo input field, and type "Hello World" into it',
    reasoning: 'Testing shadow DOM form control interactions on real component library',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Navigated to Shoelace Input component page',
        'Located an input demo component (inside shadow DOM)',
        'Successfully typed text into the shadow DOM input',
        'Text was entered correctly',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify the Shoelace component page loaded',
          'Confirm an input field was found',
          'Check that text was entered in the input',
        ],
      },
    },
  },
  metadata: {
    tags: ['web-task', 'shadow-dom', 'shoelace', 'form', 'web-components'],
    timeout: 60000,
  },
};

/**
 * Test creating a GitHub issue using web components.
 * SKIPPED: Requires GitHub authentication and real repository
 */
export const githubIssueCreationTest: TestCase<WebTaskAgentArgs> = {
  id: 'web-task-shadow-002',
  name: 'Create GitHub issue (web components)',
  description: 'Navigate to repo and create an issue using GitHub web components with shadow DOM',
  url: 'https://github.com/test-org/test-repo/issues',
  tool: 'web_task_agent',
  skip: true,
  input: {
    task: 'Create a new issue titled "Test Issue" with description "This is a test issue"',
    reasoning: 'Testing real-world GitHub workflow with shadow DOM web components',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Navigated to the new issue page',
        'Filled the title field with "Test Issue"',
        'Filled the description/body field',
        'Successfully handled GitHub markdown editor (shadow DOM)',
        'Submitted the issue successfully',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify the issue creation form was filled',
          'Confirm the issue was created',
          'Check for the new issue page or confirmation',
        ],
      },
    },
  },
  metadata: {
    tags: ['web-task', 'shadow-dom', 'github', 'real-world', 'issue-creation'],
    timeout: 60000,
  },
};

/**
 * Test editing Notion page blocks.
 * SKIPPED: Requires Notion authentication
 */
export const notionBlockEditingTest: TestCase<WebTaskAgentArgs> = {
  id: 'web-task-shadow-003',
  name: 'Edit Notion page blocks',
  description: 'Navigate and edit blocks in Notion (complex shadow DOM)',
  url: 'https://www.notion.so/test-page',
  tool: 'web_task_agent',
  skip: true,
  input: {
    task: 'Add a new heading "Test Heading" and a paragraph below it saying "This is test content"',
    reasoning: 'Testing complex shadow DOM interaction in Notion editor',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Located the Notion content editing area',
        'Created a new heading block',
        'Entered the heading text "Test Heading"',
        'Created a new paragraph block',
        'Entered the paragraph content',
        'Content was saved/persisted',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify the heading was added',
          'Confirm the paragraph content was entered',
          'Check that content appears correctly formatted',
        ],
      },
    },
  },
  metadata: {
    tags: ['web-task', 'shadow-dom', 'notion', 'real-world', 'content-editing'],
    timeout: 60000,
  },
};

/**
 * Test shopping workflow on Polymer Shop demo (real shadow DOM e-commerce).
 */
export const shadowDomShoppingTest: TestCase<WebTaskAgentArgs> = {
  id: 'web-task-shadow-004',
  name: 'Polymer Shop e-commerce workflow',
  description: 'Complete a product selection workflow on the Polymer Shop demo',
  url: 'https://shop.polymer-project.org/',
  tool: 'web_task_agent',
  input: {
    task: 'Browse the shop, navigate to "Men\'s Outerwear" category, select the first product, and add it to cart',
    reasoning: 'Testing e-commerce workflow with real Polymer web components',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Navigated to the Polymer Shop homepage',
        'Clicked on Men\'s Outerwear category',
        'Selected a product from the category',
        'Clicked Add to Cart button',
        'Cart was updated or confirmation shown',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify the shop loaded correctly',
          'Confirm a product was selected',
          'Check cart shows the added item',
        ],
      },
    },
  },
  metadata: {
    tags: ['web-task', 'shadow-dom', 'polymer', 'e-commerce', 'shopping'],
    timeout: 60000,
  },
};

/**
 * Test interacting with YouTube video player (real shadow DOM video player).
 */
export const shadowDomVideoPlayerTest: TestCase<WebTaskAgentArgs> = {
  id: 'web-task-shadow-005',
  name: 'YouTube video player controls',
  description: 'Interact with YouTube video player controls (shadow DOM)',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  tool: 'web_task_agent',
  input: {
    task: 'Play the video, then pause it, and toggle fullscreen mode on and off',
    reasoning: 'Testing shadow DOM video player interactions on YouTube',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Navigated to YouTube video page',
        'Located the video player',
        'Successfully clicked play (or video auto-played)',
        'Successfully paused the video',
        'Toggled fullscreen mode',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify YouTube video page loaded',
          'Confirm video player is visible',
          'Check that player controls were interacted with',
        ],
      },
    },
  },
  metadata: {
    tags: ['web-task', 'shadow-dom', 'youtube', 'video-player', 'media'],
    timeout: 60000,
  },
};

// Export all WebTaskAgent shadow DOM tests
export const webTaskAgentShadowDOMTests = [
  shadowDomFormWorkflowTest,
  githubIssueCreationTest,
  notionBlockEditingTest,
  shadowDomShoppingTest,
  shadowDomVideoPlayerTest,
];
