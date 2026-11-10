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
// Web Task Agent Iframe Tests
// Complex multi-step workflow tests involving iframes
// ============================================================================

/**
 * Test completing a payment flow through Stripe demo (real iframe).
 */
export const bookingWidgetIframeTest: TestCase<WebTaskAgentArgs> = {
  id: 'web-task-iframe-001',
  name: 'Complete Stripe payment demo',
  description: 'Complete payment through Stripe demo with embedded payment form',
  url: 'https://stripe-payments-demo.appspot.com/',
  tool: 'web_task_agent',
  input: {
    task: 'Complete the payment demo using test card 4242424242424242, expiry 12/34, CVC 123, and email test@example.com',
    reasoning: 'Testing payment form interaction within cross-origin iframe on Stripe demo',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Navigated to Stripe payments demo page',
        'Located the payment form (may be in iframe)',
        'Filled card number with 4242424242424242',
        'Filled expiry with 12/34 and CVC with 123',
        'Entered email address',
        'Submitted the payment form',
        'Payment was processed or confirmation shown',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify the payment form is visible',
          'Confirm card details were entered',
          'Check for payment confirmation or success indicator',
        ],
      },
    },
  },
  metadata: {
    tags: ['web-task', 'iframe', 'payment', 'stripe', 'form'],
    timeout: 60000,
  },
};

/**
 * Test completing a payment flow through a secure cross-origin iframe.
 * SKIPPED: Duplicate of iframe-001 (Stripe demo)
 */
export const paymentGatewayIframeTest: TestCase<WebTaskAgentArgs> = {
  id: 'web-task-iframe-002',
  name: 'Complete payment in secure iframe',
  description: 'Fill payment form in cross-origin secure iframe',
  url: 'https://test-pages.example.com/checkout.html',
  tool: 'web_task_agent',
  skip: true,
  input: {
    task: 'Complete the payment with card number 4242424242424242, expiry 12/25, CVV 123',
    reasoning: 'Testing payment form interaction within cross-origin iframe',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Identified the payment iframe',
        'Filled the card number field with 4242424242424242',
        'Filled the expiry date field with 12/25',
        'Filled the CVV field with 123',
        'Submitted the payment form',
        'Handled any confirmation or success page',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify the payment form is visible in the iframe',
          'Confirm card details were entered',
          'Check for payment confirmation or success indicator',
        ],
      },
    },
  },
  metadata: {
    tags: ['web-task', 'iframe', 'payment', 'cross-origin', 'form', 'secure'],
    timeout: 45000,
  },
};

/**
 * Test editing content in Google Docs (complex iframe + shadow DOM).
 * SKIPPED: Requires authentication
 */
export const googleDocsEditingTest: TestCase<WebTaskAgentArgs> = {
  id: 'web-task-iframe-003',
  name: 'Edit Google Docs document',
  description: 'Navigate and edit content in Google Docs (complex iframe + shadow DOM)',
  url: 'https://docs.google.com/document/d/test-doc/edit',
  tool: 'web_task_agent',
  skip: true,
  input: {
    task: 'Add the text "Hello World" at the beginning of the document',
    reasoning: 'Testing complex iframe and content editable interactions in Google Docs',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Loaded the document editor successfully',
        'Located the content canvas (inside iframe)',
        'Positioned cursor at the start of the document',
        'Typed the text "Hello World" correctly',
        'Text appeared in the document',
        'Document auto-saved or indicated changes',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify the document editor loaded',
          'Confirm "Hello World" text is visible at the document start',
          'Check for save indicator',
        ],
      },
    },
  },
  metadata: {
    tags: ['web-task', 'iframe', 'google-docs', 'real-world', 'content-editing'],
    timeout: 60000,
  },
};

/**
 * Test complex airline booking flow on ANA website.
 */
export const airlineBookingAnaTest: TestCase<WebTaskAgentArgs> = {
  id: 'web-task-iframe-004',
  name: 'ANA Airlines booking flow',
  description: 'Search and select flights on ANA (complex iframe structure)',
  url: 'https://www.ana.co.jp/en/us/',
  tool: 'web_task_agent',
  input: {
    task: 'Search for a round-trip flight from Seattle (SEA) to Tokyo (NRT), departing March 20, 2026 and returning March 30, 2026, for 1 adult passenger',
    reasoning: 'Testing real-world airline booking with complex iframe and widget structure',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Located the flight search widget',
        'Selected round-trip option',
        'Set departure city to New York (JFK)',
        'Set destination city to Tokyo (NRT)',
        'Set travel dates for next month',
        'Initiated the flight search',
        'Search results were displayed',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify the booking widget was found',
          'Confirm cities were correctly selected',
          'Check that search results are displayed',
        ],
      },
    },
  },
  metadata: {
    tags: ['web-task', 'iframe', 'airline', 'real-world', 'booking', 'complex'],
    timeout: 90000,
  },
};

/**
 * Test filling an embedded survey form in an iframe.
 * SKIPPED: Fake URL - no good public alternative
 */
export const embeddedSurveyIframeTest: TestCase<WebTaskAgentArgs> = {
  id: 'web-task-iframe-005',
  name: 'Complete embedded survey',
  description: 'Fill out a multi-page survey embedded in an iframe',
  url: 'https://test-pages.example.com/survey-embed.html',
  tool: 'web_task_agent',
  skip: true,
  input: {
    task: 'Complete the customer satisfaction survey with rating 5, positive feedback "Great service!", and submit it',
    reasoning: 'Testing multi-page form workflow within an embedded iframe',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Identified the survey iframe',
        'Selected rating of 5 (highest)',
        'Entered feedback text "Great service!"',
        'Navigated through survey pages if multi-page',
        'Submitted the survey',
        'Verified submission confirmation',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify survey form is visible',
          'Confirm rating was selected',
          'Check for submission confirmation',
        ],
      },
    },
  },
  metadata: {
    tags: ['web-task', 'iframe', 'survey', 'form', 'multi-page'],
  },
};

/**
 * Test interacting with Starbucks store locator (real map widget).
 */
export const embeddedMapWidgetTest: TestCase<WebTaskAgentArgs> = {
  id: 'web-task-iframe-006',
  name: 'Starbucks store locator',
  description: 'Search for Starbucks stores using embedded map',
  url: 'https://www.starbucks.com/store-locator',
  tool: 'web_task_agent',
  input: {
    task: 'Search for Starbucks stores near "San Francisco, CA" and find store hours for the first result',
    reasoning: 'Testing map widget and store locator interactions',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Navigated to Starbucks store locator page',
        'Entered "San Francisco, CA" in the search field',
        'Store locations were displayed on the map or list',
        'Selected or viewed the first store result',
        'Store hours or details were shown',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify store locator page loaded',
          'Confirm store locations are displayed',
          'Check that store hours or details are visible',
        ],
      },
    },
  },
  metadata: {
    tags: ['web-task', 'iframe', 'map', 'starbucks', 'store-locator'],
    timeout: 60000,
  },
};

// ============================================================================
// Hybrid Snapshot Utilization Tests
// Tests focusing on multi-frame data extraction and EncodedId workflows
// ============================================================================

/**
 * Test extracting data from multiple frames using hybrid snapshot.
 * SKIPPED: Fake URL - no good public alternative
 */
export const multiFrameExtractionTest: TestCase<WebTaskAgentArgs> = {
  id: 'web-task-hybrid-001',
  name: 'Extract data from multiple frames',
  description: 'Use hybrid snapshot to extract content from main frame and iframes',
  url: 'https://test-pages.example.com/multi-frame-content.html',
  tool: 'web_task_agent',
  skip: true,
  input: {
    task: 'Extract all product names and prices from the page, including those displayed in iframes',
    reasoning: 'Testing hybrid accessibility tree for cross-frame content extraction',
    context: {
      extractionMode: 'multi-frame',
    },
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Captured hybrid snapshot that includes multiple frames',
        'Extracted content from the main frame',
        'Extracted content from child iframes',
        'Combined all results correctly',
        'No products were missed from any frame',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify all product listings are visible',
          'Confirm products in iframes are included',
          'Check extracted data matches visible content',
        ],
      },
    },
  },
  metadata: {
    tags: ['web-task', 'hybrid-snapshot', 'extraction', 'multi-frame', 'data'],
  },
};

/**
 * Test workflow using EncodedId for precise element targeting.
 * SKIPPED: Fake URL - no good public alternative
 */
export const encodedIdWorkflowTest: TestCase<WebTaskAgentArgs> = {
  id: 'web-task-hybrid-002',
  name: 'Workflow using EncodedId targeting',
  description: 'Complete multi-step workflow referencing elements by EncodedId from accessibility tree',
  url: 'https://test-pages.example.com/encoded-id-workflow.html',
  tool: 'web_task_agent',
  skip: true,
  input: {
    task: 'Fill the registration form and submit it, using the accessibility tree for precise element targeting',
    reasoning: 'Testing EncodedId-based element resolution for reliable form interactions',
    context: {
      useEncodedIdTargeting: true,
    },
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Used hybrid accessibility tree to identify form elements',
        'Referenced elements by EncodedId for targeting',
        'Resolved EncodedIds to correct DOM elements',
        'Filled all form fields correctly',
        'Submitted the form successfully',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify form fields were targeted correctly',
          'Confirm all fields were filled',
          'Check for form submission confirmation',
        ],
      },
    },
  },
  metadata: {
    tags: ['web-task', 'hybrid-snapshot', 'encoded-id', 'workflow', 'form'],
  },
};

/**
 * Test navigating dashboard with multiple iframe panels.
 * SKIPPED: Fake URL - no good public alternative
 */
export const dashboardMultiIframeTest: TestCase<WebTaskAgentArgs> = {
  id: 'web-task-iframe-007',
  name: 'Navigate multi-iframe dashboard',
  description: 'Interact with a dashboard that has multiple iframe panels',
  url: 'https://test-pages.example.com/dashboard-panels.html',
  tool: 'web_task_agent',
  skip: true,
  input: {
    task: 'Click the "Refresh" button in the analytics panel, then view the sales chart in the reports panel',
    reasoning: 'Testing navigation and interaction across multiple iframe panels',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Identified the analytics iframe panel',
        'Clicked the Refresh button in analytics panel',
        'Analytics data was refreshed',
        'Navigated to the reports iframe panel',
        'Located and interacted with the sales chart',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify analytics panel refresh occurred',
          'Confirm sales chart is visible in reports panel',
          'Check that correct panels were targeted',
        ],
      },
    },
  },
  metadata: {
    tags: ['web-task', 'iframe', 'dashboard', 'multi-panel', 'navigation'],
  },
};

// Export all WebTaskAgent iframe and hybrid snapshot tests
export const webTaskAgentIframeTests = [
  bookingWidgetIframeTest,
  paymentGatewayIframeTest,
  googleDocsEditingTest,
  airlineBookingAnaTest,
  embeddedSurveyIframeTest,
  embeddedMapWidgetTest,
  dashboardMultiIframeTest,
];

export const hybridSnapshotTests = [
  multiFrameExtractionTest,
  encodedIdWorkflowTest,
];
