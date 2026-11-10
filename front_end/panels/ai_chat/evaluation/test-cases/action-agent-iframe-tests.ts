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
// Iframe Action Tests
// Tests for interacting with elements inside iframes (SPIF and OOPIF)
// ============================================================================

/**
 * Test clicking a button inside a same-process iframe (SPIF).
 * Uses W3Schools TryIt editor which has content in an iframe.
 */
export const iframeBasicClickTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-iframe-001',
  name: 'Click button inside iframe',
  description: 'Click a button that exists inside an iframe',
  url: 'https://www.w3schools.com/html/tryit.asp?filename=tryhtml_form_submit',
  tool: 'action_agent',
  input: {
    objective: 'Click the "Submit" button in the form shown in the right-side result iframe',
    reasoning: 'Testing cross-frame element interaction capability',
    hint: 'The form is displayed in the result iframe on the right side of the TryIt editor. Click the Submit button in that iframe.',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Identified the result iframe in the TryIt editor',
        'Located the Submit button within the iframe',
        'Click was executed in the correct frame context',
        'Form submission triggered or button click registered',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify the Submit button in the result iframe was clicked',
          'Confirm the form submission occurred',
        ],
      },
    },
  },
  metadata: {
    tags: ['action', 'iframe', 'click', 'w3schools', 'form'],
  },
};

/**
 * Test clicking in nested iframes.
 * Uses the-internet.herokuapp.com which has a purpose-built nested frames test page.
 */
export const iframeNestedTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-iframe-002',
  name: 'Navigate nested iframes',
  description: 'Interact with element in nested iframe structure',
  url: 'https://the-internet.herokuapp.com/nested_frames',
  tool: 'action_agent',
  input: {
    objective: 'Click or interact with the MIDDLE frame content in the nested frame structure',
    reasoning: 'Testing multi-level iframe traversal capability',
    hint: 'The page has a frameset with top and bottom frames. The top frame contains LEFT, MIDDLE, and RIGHT frames. Target the MIDDLE frame.',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Successfully identified the nested frame structure',
        'Navigated to the correct frame (MIDDLE)',
        'Located content in the target frame',
        'No frame navigation or context errors',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify the MIDDLE frame was identified and interacted with',
          'Confirm the nested frame traversal worked',
        ],
      },
    },
  },
  metadata: {
    tags: ['action', 'iframe', 'nested', 'the-internet', 'frameset'],
  },
};

/**
 * Test clicking an element in a complex real-world page with iframes and shadow DOM.
 * Uses YouTube which has both iframes and shadow DOM components.
 */
export const iframeShadowComboTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-iframe-003',
  name: 'Shadow DOM inside iframe (YouTube)',
  description: 'Interact with elements in YouTube which uses iframes and shadow DOM',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  tool: 'action_agent',
  input: {
    objective: 'Click the video title or channel name link to test element targeting in complex DOM',
    reasoning: 'Testing combined iframe + shadow DOM traversal in real-world application',
    hint: 'YouTube uses web components with shadow DOM. The video title and channel name are accessible links.',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Located elements in YouTube complex DOM structure',
        'Successfully handled shadow DOM components',
        'Click was executed on the target element',
        'Combined traversal worked correctly',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify the target link was clicked',
          'Confirm the click registered or navigation occurred',
        ],
      },
    },
  },
  metadata: {
    tags: ['action', 'iframe', 'shadow-dom', 'youtube', 'real-world'],
    timeout: 30000,
  },
};

/**
 * Test interacting with YouTube video player controls (real-world).
 */
export const youtubeVideoControlsTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-iframe-004',
  name: 'YouTube video player controls',
  description: 'Interact with YouTube video player (shadow DOM + iframes)',
  url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  tool: 'action_agent',
  input: {
    objective: 'Click the play/pause button on the video player',
    reasoning: 'Testing real-world complex DOM structure with shadow DOM and iframes',
    hint: 'YouTube uses web components with shadow DOM. The video player controls are inside these components.',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Located the video player controls',
        'Successfully handled YouTube shadow DOM components',
        'Play/pause button was clicked',
        'Video playback state changed',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify the play/pause button was clicked',
          'Confirm video state changed (playing <-> paused)',
        ],
      },
    },
  },
  metadata: {
    tags: ['action', 'iframe', 'shadow-dom', 'youtube', 'real-world', 'video'],
    timeout: 30000,
  },
};

/**
 * Test filling a form inside an iframe.
 * Uses W3Schools TryIt editor which has form content in an iframe.
 */
export const iframeFormFillTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-iframe-005',
  name: 'Fill form inside iframe',
  description: 'Fill out a form that exists inside an iframe',
  url: 'https://www.w3schools.com/html/tryit.asp?filename=tryhtml_input_submit',
  tool: 'action_agent',
  input: {
    objective: 'Fill the text input field with "John Doe" in the result iframe on the right side',
    reasoning: 'Testing form interaction within iframe context',
    hint: 'The form is displayed in the result iframe on the right side. Fill the input field in that iframe.',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Navigated to the result iframe',
        'Located the text input field',
        'Successfully filled with "John Doe"',
        'Form field value was set correctly',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify the form field was filled with "John Doe"',
          'Confirm the input is visible in the iframe',
        ],
      },
    },
  },
  metadata: {
    tags: ['action', 'iframe', 'form', 'fill', 'w3schools'],
  },
};

/**
 * Test cross-frame element targeting.
 * Uses W3Schools iframe example page.
 */
export const iframeHopNotationTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-iframe-006',
  name: 'Cross-frame element targeting',
  description: 'Target and interact with element across iframe boundary',
  url: 'https://www.w3schools.com/tags/tryit.asp?filename=tryhtml_iframe',
  tool: 'action_agent',
  input: {
    objective: 'Click any link inside the embedded iframe in the result pane',
    reasoning: 'Testing cross-iframe element targeting capability',
    hint: 'The result iframe contains an embedded iframe showing W3Schools content. Find and click a link in that embedded content.',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Identified the nested iframe structure',
        'Traversed to the embedded iframe content',
        'Located a clickable link',
        'Click was executed successfully',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify a link in the embedded iframe was clicked',
          'Confirm cross-frame traversal worked',
        ],
      },
    },
  },
  metadata: {
    tags: ['action', 'iframe', 'cross-frame', 'w3schools', 'traversal'],
  },
};

// ============================================================================
// EncodedId-based Action Tests
// Tests for using EncodedId format for cross-frame element targeting
// ============================================================================

/**
 * Test clicking by EncodedId reference.
 * Uses the-internet.herokuapp.com add/remove elements page.
 */
export const encodedIdClickTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-encoded-001',
  name: 'Click by EncodedId reference',
  description: 'Action agent receives EncodedId from accessibility tree and uses it to click',
  url: 'https://the-internet.herokuapp.com/add_remove_elements/',
  tool: 'action_agent',
  input: {
    objective: 'Click the "Add Element" button to add a new element to the page',
    reasoning: 'Testing EncodedId-based element targeting from accessibility tree',
    hint: 'The accessibility tree will show buttons with EncodedIds. Use the EncodedId to target and click the Add Element button.',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Identified the button in the accessibility tree with its EncodedId',
        'Used the EncodedId to resolve the element',
        'Executed click on the correct button',
        'A new "Delete" button appeared after clicking',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify the Add Element button was clicked',
          'Confirm a new Delete button appeared',
        ],
      },
    },
  },
  metadata: {
    tags: ['action', 'encoded-id', 'click', 'the-internet'],
  },
};

/**
 * Test cross-frame EncodedId resolution.
 * Uses the-internet.herokuapp.com nested_frames page for multi-frame testing.
 */
export const encodedIdCrossFrameTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-encoded-002',
  name: 'Cross-frame EncodedId resolution',
  description: 'Resolve and interact with element in child frame using EncodedId',
  url: 'https://the-internet.herokuapp.com/nested_frames',
  tool: 'action_agent',
  input: {
    objective: 'Identify and interact with content in one of the child frames using EncodedId from the accessibility tree',
    reasoning: 'Testing EncodedId resolution across frame boundaries',
    hint: 'The page has nested frames. Each frame has its own EncodedId prefix indicating frame ordinal. Use this to target elements in specific frames.',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Identified elements in child frames via accessibility tree',
        'Correctly parsed frame ordinals from EncodedIds',
        'Resolved element location in the correct frame',
        'Cross-frame targeting worked correctly',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify the correct frame was targeted',
          'Confirm cross-frame EncodedId resolution worked',
        ],
      },
    },
  },
  metadata: {
    tags: ['action', 'encoded-id', 'cross-frame', 'the-internet', 'nested'],
  },
};

// Export all iframe and EncodedId action tests
export const iframeActionTests = [
  iframeBasicClickTest,
  iframeNestedTest,
  iframeShadowComboTest,
  youtubeVideoControlsTest,
  iframeFormFillTest,
  iframeHopNotationTest,
];

export const encodedIdActionTests = [
  encodedIdClickTest,
  encodedIdCrossFrameTest,
];
