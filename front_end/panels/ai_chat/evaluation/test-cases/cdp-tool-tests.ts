// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * CDP Tool Tests - Comprehensive evaluation tests for tools fixed for CDP adapter compatibility.
 *
 * These tests verify the following tools work correctly in the eval runner context:
 * - NavigateBackTool (3 tests)
 * - ExecuteCodeTool (6 tests)
 * - HybridAccessibilityTreeTool (5 tests)
 * - WaitTool (4 tests)
 * - NodeIDsToURLsTool (3 tests)
 * - NetworkAnalysisTool (1 test)
 * - ObjectiveDrivenActionTool (2 tests)
 * - GetPageContent/searchQuery (4 tests)
 */

import type { TestCase } from '../framework/types.js';

// ============================================================================
// NavigateBackTool Tests (3)
// ============================================================================

export interface NavigateBackArgs {
  steps?: number;
}

export const navigateBackEcommerceTest: TestCase<NavigateBackArgs> = {
  id: 'tool-navigate-back-001',
  name: 'E-Commerce Back Navigation',
  description: 'Navigate through Amazon pages then go back to verify history navigation works',
  url: 'https://www.amazon.com',
  tool: 'navigate_back',
  input: {
    steps: 1,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool executed without throwing an error',
        'Returned a valid result object with navigation info',
        'Browser history navigation was triggered',
        'Result contains current URL after navigation',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify the page changed after back navigation',
          'Check if URL reflects the previous page in history',
        ],
      },
    },
  },
  metadata: {
    tags: ['tool', 'navigate-back', 'cdp', 'ecommerce', 'amazon'],
    timeout: 60000,
  },
};

export const navigateBackNewsMultiStepTest: TestCase<NavigateBackArgs> = {
  id: 'tool-navigate-back-002',
  name: 'News Multi-Step Back Navigation',
  description: 'Navigate through BBC news pages, then go back 2 steps to verify multi-step back works',
  url: 'https://www.bbc.com/news',
  tool: 'navigate_back',
  input: {
    steps: 2,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool accepted steps parameter correctly',
        'Executed without CDP errors',
        'Navigation completed or returned appropriate error if insufficient history',
        'Result indicates navigation status',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify page changed to reflect going back in history',
          'Check URL changed to an earlier visited page',
        ],
      },
    },
  },
  metadata: {
    tags: ['tool', 'navigate-back', 'cdp', 'news', 'bbc', 'multi-step'],
    timeout: 60000,
  },
};

export const navigateBackHistoryBoundaryTest: TestCase<NavigateBackArgs> = {
  id: 'tool-navigate-back-003',
  name: 'History Boundary Error Handling',
  description: 'Attempt to go back 5 steps with insufficient history - should handle gracefully',
  url: 'https://twitter.com',
  tool: 'navigate_back',
  input: {
    steps: 5,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool handled insufficient history gracefully',
        'Did not throw unhandled exception',
        'Returned error or info message about history limit',
        'Browser remained in stable state',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify page remained stable despite insufficient history',
          'Check that no browser crash or error dialog appeared',
        ],
      },
    },
  },
  metadata: {
    tags: ['tool', 'navigate-back', 'cdp', 'error-handling', 'edge-case'],
    timeout: 45000,
  },
};

// ============================================================================
// ExecuteCodeTool Tests (5)
// ============================================================================

export interface ExecuteCodeArgs {
  code: string;
  reasoning: string;
}

export const executeCodeProductExtractionTest: TestCase<ExecuteCodeArgs> = {
  id: 'tool-execute-code-001',
  name: 'Product Extraction from Search Results',
  description: 'Extract product titles, prices, and ratings from Amazon search results using execute_code',
  url: 'https://www.amazon.com/s?k=laptop',
  tool: 'execute_code',
  input: {
    code: `Array.from(document.querySelectorAll('[data-component-type="s-search-result"]'))
      .slice(0, 5)
      .map(el => ({
        title: el.querySelector('h2')?.textContent?.trim() || 'N/A',
        price: el.querySelector('.a-price .a-offscreen')?.textContent?.trim() ||
               el.querySelector('.a-price-whole')?.textContent?.trim() || 'N/A',
        rating: el.querySelector('[data-cy="reviews-ratings-count"]')?.textContent?.split(' ')[0] ||
                el.querySelector('.a-icon-star-small')?.textContent?.split(' ')[0] || 'N/A'
      }))`,
    reasoning: 'Testing JavaScript code execution in page context to extract structured product data',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Code executed successfully via CDP Runtime.evaluate',
        'Returned an array of product objects',
        'Each product has title, price, and rating fields',
        'No JavaScript errors or exceptions occurred',
        'Result is JSON-serializable',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify products are visible on the page before extraction',
          'Check extracted data matches visible product information',
        ],
      },
    },
  },
  metadata: {
    tags: ['tool', 'execute-code', 'cdp', 'extraction', 'amazon', 'ecommerce'],
    timeout: 90000,
    flaky: true,
  },
};

export const executeCodeMetadataTest: TestCase<ExecuteCodeArgs> = {
  id: 'tool-execute-code-002',
  name: 'Page Metadata Extraction',
  description: 'Extract title, description, headings, and word count from Wikipedia article',
  url: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
  tool: 'execute_code',
  input: {
    code: `({
      title: document.title,
      url: window.location.href,
      headings: Array.from(document.querySelectorAll('h1, h2, h3')).slice(0, 10)
        .map(h => ({level: h.tagName, text: h.textContent.trim()})),
      wordCount: document.body.innerText.split(/\\s+/).length
    })`,
    reasoning: 'Testing page metadata extraction with various DOM APIs',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Code executed without errors',
        'Returned object with title, url, headings, and wordCount',
        'Title matches page title',
        'URL matches expected Wikipedia URL',
        'Headings array contains heading objects with level and text',
        'Word count is a positive number',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify Wikipedia article loaded correctly',
          'Check that page title and headings are visible',
        ],
      },
    },
  },
  metadata: {
    tags: ['tool', 'execute-code', 'cdp', 'metadata', 'wikipedia'],
    timeout: 60000,
  },
};

export const executeCodeNavigationLinksTest: TestCase<ExecuteCodeArgs> = {
  id: 'tool-execute-code-003',
  name: 'Navigation Links Extraction',
  description: 'Extract nav links, footer links, and count internal vs external links from GitHub',
  url: 'https://github.com',
  tool: 'execute_code',
  input: {
    code: `(() => {
      const allLinks = Array.from(document.links);
      const currentHost = window.location.host;
      const internal = allLinks.filter(a => a.host === currentHost);
      const external = allLinks.filter(a => a.host !== currentHost);
      return {
        totalLinks: allLinks.length,
        internalCount: internal.length,
        externalCount: external.length,
        navLinks: Array.from(document.querySelectorAll('nav a')).slice(0, 10)
          .map(a => ({text: a.textContent?.trim(), href: a.href})),
        footerLinks: Array.from(document.querySelectorAll('footer a')).slice(0, 10)
          .map(a => ({text: a.textContent?.trim(), href: a.href}))
      };
    })()`,
    reasoning: 'Testing complex link extraction with internal/external categorization',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'IIFE executed successfully',
        'Returned object with link counts',
        'internalCount + externalCount approximately equals totalLinks',
        'navLinks array populated with link objects',
        'footerLinks array populated with link objects',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify GitHub homepage loaded with navigation and footer',
          'Check that links are visible in nav and footer areas',
        ],
      },
    },
  },
  metadata: {
    tags: ['tool', 'execute-code', 'cdp', 'links', 'github'],
    timeout: 60000,
  },
};

export const executeCodeFormFieldsTest: TestCase<ExecuteCodeArgs> = {
  id: 'tool-execute-code-004',
  name: 'Form Fields Extraction',
  description: 'Extract all form inputs, their types, values, and required flags from httpbin form',
  url: 'https://httpbin.org/forms/post',
  tool: 'execute_code',
  input: {
    code: `Array.from(document.querySelectorAll('input, select, textarea')).map(el => ({
      tagName: el.tagName.toLowerCase(),
      type: el.type || 'text',
      name: el.name || null,
      id: el.id || null,
      value: el.value || '',
      required: el.required || false,
      placeholder: el.placeholder || null
    }))`,
    reasoning: 'Testing form field introspection for automation planning',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Code executed without errors',
        'Returned array of form field objects',
        'Each field has tagName, type, name properties',
        'Various input types detected (text, checkbox, radio, etc.)',
        'Required and placeholder attributes captured correctly',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify httpbin form is visible with various input types',
          'Check that form contains the expected fields',
        ],
      },
    },
  },
  metadata: {
    tags: ['tool', 'execute-code', 'cdp', 'form', 'httpbin'],
    timeout: 45000,
  },
};

export const executeCodeTableDataTest: TestCase<ExecuteCodeArgs> = {
  id: 'tool-execute-code-005',
  name: 'Table Data Parsing',
  description: 'Parse HTML table into structured JSON with headers from Wikipedia population table',
  url: 'https://en.wikipedia.org/wiki/List_of_countries_by_population_(United_Nations)',
  tool: 'execute_code',
  input: {
    code: `(() => {
      const table = document.querySelector('table.wikitable');
      if (!table) return {error: 'No table found'};
      const headers = Array.from(table.querySelectorAll('th')).slice(0, 5)
        .map(th => th.textContent?.trim() || '');
      const rows = Array.from(table.querySelectorAll('tbody tr')).slice(0, 10)
        .map(row => {
          const cells = Array.from(row.querySelectorAll('td'));
          return cells.slice(0, 5).map(td => td.textContent?.trim() || '');
        }).filter(row => row.length > 0);
      return {headers, rows, rowCount: rows.length};
    })()`,
    reasoning: 'Testing complex table parsing with header extraction',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Code executed successfully',
        'Returned object with headers and rows arrays',
        'Headers array contains column names',
        'Rows array contains parsed table data',
        'Data is properly structured as arrays of strings',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify Wikipedia population table is visible',
          'Check that table has headers and data rows',
        ],
      },
    },
  },
  metadata: {
    tags: ['tool', 'execute-code', 'cdp', 'table', 'wikipedia', 'parsing'],
    timeout: 60000,
  },
};

export const executeCodeBookCatalogTest: TestCase<ExecuteCodeArgs> = {
  id: 'tool-execute-code-006',
  name: 'Book Catalog Extraction',
  description: 'Extract book titles, prices, and stock status from books.toscrape.com - stable scraping target',
  url: 'https://books.toscrape.com/',
  tool: 'execute_code',
  input: {
    code: `Array.from(document.querySelectorAll('article.product_pod'))
      .slice(0, 5)
      .map(el => ({
        title: el.querySelector('h3 a')?.getAttribute('title') || 'N/A',
        price: el.querySelector('.price_color')?.textContent?.trim() || 'N/A',
        inStock: el.querySelector('.instock') ? true : false
      }))`,
    reasoning: 'Testing JavaScript code execution on stable scraping target (books.toscrape.com)',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Code executed successfully via CDP Runtime.evaluate',
        'Returned an array of 5 book objects',
        'Each book has title, price, and inStock fields',
        'Prices are in currency format (e.g., £51.77)',
        'No JavaScript errors or exceptions occurred',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify books.toscrape.com homepage loaded with book listings',
          'Check extracted data matches visible book information',
        ],
      },
    },
  },
  metadata: {
    tags: ['tool', 'execute-code', 'cdp', 'extraction', 'books', 'stable'],
    timeout: 60000,
  },
};

// ============================================================================
// HybridAccessibilityTreeTool Tests (5)
// ============================================================================

export interface HybridAccessibilityTreeArgs {
  focusSelector?: string;
  pierceShadow?: boolean;
}

export const hybridA11yComplexInteractiveTest: TestCase<HybridAccessibilityTreeArgs> = {
  id: 'tool-hybrid-a11y-001',
  name: 'Complex Interactive Page Capture',
  description: 'Capture accessibility tree from Google search results with rich UI elements',
  url: 'https://www.google.com/search?q=weather',
  tool: 'get_hybrid_accessibility_tree',
  input: {
    pierceShadow: true,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool returned a valid result object',
        'tree property contains readable accessibility tree',
        'elementMap populated with EncodedId -> XPath mappings',
        'EncodedIds follow format "frameOrdinal-backendNodeId"',
        'Captured 50+ elements from the rich search interface',
        'metadata.elementCount reflects captured elements',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify Google search results page loaded with weather widget',
          'Check that page has various interactive elements visible',
        ],
      },
    },
  },
  metadata: {
    tags: ['tool', 'hybrid-a11y', 'cdp', 'google', 'interactive'],
    timeout: 90000,
  },
};

export const hybridA11yShadowDOMTest: TestCase<HybridAccessibilityTreeArgs> = {
  id: 'tool-hybrid-a11y-002',
  name: 'Shadow DOM Piercing Capture',
  description: 'Capture accessibility tree from YouTube with shadow DOM web components',
  url: 'https://www.youtube.com',
  tool: 'get_hybrid_accessibility_tree',
  input: {
    pierceShadow: true,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool executed successfully with pierceShadow: true',
        'tree contains elements from inside shadow roots',
        'XPaths in elementMap may contain "//" for shadow hops',
        'Captured YouTube player controls or nav elements',
        'metadata.piercedShadow is true',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify YouTube homepage loaded with shadow DOM components',
          'Check that video thumbnails and nav elements are visible',
        ],
      },
    },
  },
  metadata: {
    tags: ['tool', 'hybrid-a11y', 'cdp', 'shadow-dom', 'youtube'],
    timeout: 90000,
    flaky: true,
  },
};

export const hybridA11yMultiFrameTest: TestCase<HybridAccessibilityTreeArgs> = {
  id: 'tool-hybrid-a11y-003',
  name: 'Multi-Frame Capture',
  description: 'Capture accessibility tree from page with nested frames',
  url: 'https://the-internet.herokuapp.com/nested_frames',
  tool: 'get_hybrid_accessibility_tree',
  input: {
    pierceShadow: true,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool captured content from multiple frames',
        'frameCount > 1 indicating multiple frames detected',
        'EncodedIds have different frame ordinals (0, 1, 2, etc.)',
        'tree contains content from nested frame structure',
        'elementMap has entries from different frames',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify page has visible frame structure (nested_frames)',
          'Check that different frame areas contain distinct content',
        ],
      },
    },
  },
  metadata: {
    tags: ['tool', 'hybrid-a11y', 'cdp', 'multi-frame', 'iframe'],
    timeout: 60000,
  },
};

export const hybridA11yFormHeavyTest: TestCase<HybridAccessibilityTreeArgs> = {
  id: 'tool-hybrid-a11y-004',
  name: 'Form-Heavy Page Capture',
  description: 'Capture accessibility tree from LinkedIn login with form elements',
  url: 'https://www.linkedin.com/login',
  tool: 'get_hybrid_accessibility_tree',
  input: {
    pierceShadow: true,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool captured form elements correctly',
        'tree contains role=textbox elements for inputs',
        'tree contains role=button elements',
        'Form labels and associated inputs captured',
        'Login form structure represented in tree',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify LinkedIn login form is visible',
          'Check that username, password fields and login button are present',
        ],
      },
    },
  },
  metadata: {
    tags: ['tool', 'hybrid-a11y', 'cdp', 'form', 'linkedin'],
    timeout: 60000,
  },
};

export const hybridA11ySPADynamicTest: TestCase<HybridAccessibilityTreeArgs> = {
  id: 'tool-hybrid-a11y-005',
  name: 'SPA Dynamic Content Capture',
  description: 'Capture accessibility tree from GitHub SPA with dynamic content',
  url: 'https://github.com',
  tool: 'get_hybrid_accessibility_tree',
  input: {
    pierceShadow: true,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool captured dynamically loaded content',
        'tree includes navigation and main content areas',
        'urlMap populated with link URLs',
        'Interactive elements have proper roles',
        'SPA content captured without issues',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify GitHub homepage loaded with dynamic content',
          'Check that navigation, search, and content areas are visible',
        ],
      },
    },
  },
  metadata: {
    tags: ['tool', 'hybrid-a11y', 'cdp', 'spa', 'github', 'dynamic'],
    timeout: 60000,
  },
};

// ============================================================================
// WaitTool Tests (4)
// ============================================================================

export interface WaitArgs {
  seconds?: number;
  duration?: number;
}

export const waitBasicTest: TestCase<WaitArgs> = {
  id: 'tool-wait-001',
  name: 'Basic Wait Execution',
  description: 'Test basic wait with 2 second delay and viewport summary return',
  url: 'https://www.google.com',
  tool: 'wait_for_page_load',
  input: {
    seconds: 2,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool waited approximately 2 seconds',
        'Returned a valid result object',
        'Result includes viewportSummary or similar output',
        'No CDP errors occurred during wait',
      ],
      visualVerification: {
        enabled: false,
        captureBeforeAction: false,
        captureAfterAction: false,
        verificationPrompts: [],
      },
    },
  },
  metadata: {
    tags: ['tool', 'wait', 'cdp', 'basic'],
    timeout: 30000,
  },
};

export const waitDurationAliasTest: TestCase<WaitArgs> = {
  id: 'tool-wait-002',
  name: 'Duration Parameter Alias',
  description: 'Test that duration parameter works as alias for seconds',
  url: 'https://www.google.com',
  tool: 'wait_for_page_load',
  input: {
    duration: 1.5,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool accepted duration parameter',
        'Waited approximately 1.5 seconds',
        'Returned valid result',
        'Duration alias worked correctly',
      ],
      visualVerification: {
        enabled: false,
        captureBeforeAction: false,
        captureAfterAction: false,
        verificationPrompts: [],
      },
    },
  },
  metadata: {
    tags: ['tool', 'wait', 'cdp', 'alias'],
    timeout: 30000,
  },
};

export const waitBelowMinimumTest: TestCase<WaitArgs> = {
  id: 'tool-wait-003',
  name: 'Below Minimum Validation',
  description: 'Test that wait below 0.1 seconds returns validation error',
  url: 'https://www.google.com',
  tool: 'wait_for_page_load',
  input: {
    seconds: 0.05,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool returned an error result',
        'Error message mentions minimum threshold (0.1 seconds)',
        'Did not actually wait',
        'Validation occurred before execution',
      ],
      visualVerification: {
        enabled: false,
        captureBeforeAction: false,
        captureAfterAction: false,
        verificationPrompts: [],
      },
    },
  },
  metadata: {
    tags: ['tool', 'wait', 'cdp', 'validation', 'error'],
    timeout: 15000,
  },
};

export const waitAboveMaximumTest: TestCase<WaitArgs> = {
  id: 'tool-wait-004',
  name: 'Above Maximum Validation',
  description: 'Test that wait above 300 seconds returns validation error',
  url: 'https://www.google.com',
  tool: 'wait_for_page_load',
  input: {
    seconds: 400,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool returned an error result',
        'Error message mentions maximum threshold (300 seconds)',
        'Did not start a long wait',
        'Validation occurred immediately',
      ],
      visualVerification: {
        enabled: false,
        captureBeforeAction: false,
        captureAfterAction: false,
        verificationPrompts: [],
      },
    },
  },
  metadata: {
    tags: ['tool', 'wait', 'cdp', 'validation', 'error'],
    timeout: 15000,
  },
};

// ============================================================================
// NodeIDsToURLsTool Tests (3)
// ============================================================================

export interface NodeIDsToURLsArgs {
  nodeIds: number[];
}

export const nodeIdsToUrlsValidTest: TestCase<NodeIDsToURLsArgs> = {
  id: 'tool-nodeids-to-urls-001',
  name: 'Valid NodeIds Resolution',
  description: 'Resolve valid node IDs from accessibility tree to URLs',
  url: 'https://www.google.com',
  tool: 'node_ids_to_urls',
  input: {
    nodeIds: [1, 2, 3], // Will need real nodeIds from a11y tree in practice
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool executed without CDP errors',
        'Returned array of URL results',
        'Each result corresponds to a nodeId',
        'URLs are absolute (https://...)',
        'Gracefully handles nodes without URLs',
      ],
      visualVerification: {
        enabled: false,
        captureBeforeAction: false,
        captureAfterAction: false,
        verificationPrompts: [],
      },
    },
  },
  metadata: {
    tags: ['tool', 'nodeids-to-urls', 'cdp', 'resolution'],
    timeout: 30000,
  },
};

export const nodeIdsToUrlsEmptyArrayTest: TestCase<NodeIDsToURLsArgs> = {
  id: 'tool-nodeids-to-urls-002',
  name: 'Empty Array Validation',
  description: 'Test that empty nodeIds array returns validation error',
  url: 'https://www.google.com',
  tool: 'node_ids_to_urls',
  input: {
    nodeIds: [],
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool returned an error result',
        'Error message indicates array must not be empty',
        'Validation occurred before processing',
        'No CDP calls made with empty input',
      ],
      visualVerification: {
        enabled: false,
        captureBeforeAction: false,
        captureAfterAction: false,
        verificationPrompts: [],
      },
    },
  },
  metadata: {
    tags: ['tool', 'nodeids-to-urls', 'cdp', 'validation', 'error'],
    timeout: 15000,
  },
};

export const nodeIdsToUrlsInvalidIdsTest: TestCase<NodeIDsToURLsArgs> = {
  id: 'tool-nodeids-to-urls-003',
  name: 'Invalid NodeIds Handling',
  description: 'Test graceful handling of non-existent node IDs',
  url: 'https://www.google.com',
  tool: 'node_ids_to_urls',
  input: {
    nodeIds: [999999, 888888, 777777],
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool executed without crashing',
        'Returned result array (may have undefined/null entries)',
        'Did not throw unhandled exception',
        'Gracefully indicated which IDs were invalid',
      ],
      visualVerification: {
        enabled: false,
        captureBeforeAction: false,
        captureAfterAction: false,
        verificationPrompts: [],
      },
    },
  },
  metadata: {
    tags: ['tool', 'nodeids-to-urls', 'cdp', 'error-handling'],
    timeout: 30000,
  },
};

// ============================================================================
// NetworkAnalysisTool Tests (1)
// ============================================================================

export interface NetworkAnalysisArgs {
  captureRequests?: boolean;
}

export const networkAnalysisBrowserOnlyTest: TestCase<NetworkAnalysisArgs> = {
  id: 'tool-network-analysis-001',
  name: 'Browser-Only Environment Check',
  description: 'Verify NetworkAnalysisTool returns appropriate error in eval runner (Node.js) context',
  url: 'https://www.google.com',
  tool: 'analyze_network',
  input: {
    captureRequests: true,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool returned an error result',
        'Error indicates browser-only functionality',
        'Did not crash or throw unhandled exception',
        'Clear error message about environment limitation',
      ],
      visualVerification: {
        enabled: false,
        captureBeforeAction: false,
        captureAfterAction: false,
        verificationPrompts: [],
      },
    },
  },
  metadata: {
    tags: ['tool', 'network-analysis', 'cdp', 'browser-only', 'error'],
    timeout: 15000,
  },
};

// ============================================================================
// ObjectiveDrivenActionTool Tests (2)
// ============================================================================

export interface ObjectiveDrivenActionArgs {
  objective: string;
  reasoning?: string;
}

export const objectiveActionClickTest: TestCase<ObjectiveDrivenActionArgs> = {
  id: 'tool-objective-action-001',
  name: 'Objective-Driven Click Action',
  description: 'Use objective-driven approach to click the Start button',
  url: 'https://the-internet.herokuapp.com/dynamic_loading/1',
  tool: 'objective_driven_action',
  input: {
    objective: 'Click the Start button',
    reasoning: 'Testing objective-driven click action with CDP adapter',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool understood the click objective',
        'Located the Start button element',
        'Successfully executed click action via CDP',
        'Returned result indicating action was taken',
        'Dynamic loading was triggered',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify Start button was present before action',
          'Check that loading or new content appeared after action',
        ],
      },
    },
  },
  metadata: {
    tags: ['tool', 'objective-action', 'cdp', 'click', 'dynamic'],
    timeout: 60000,
  },
};

export const objectiveActionFormFillTest: TestCase<ObjectiveDrivenActionArgs> = {
  id: 'tool-objective-action-002',
  name: 'Objective-Driven Form Fill Action',
  description: 'Use objective-driven approach to fill username field',
  url: 'https://the-internet.herokuapp.com/login',
  tool: 'objective_driven_action',
  input: {
    objective: "Fill the username field with 'testuser'",
    reasoning: 'Testing objective-driven form fill action with CDP adapter',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool understood the fill objective',
        'Located the username input field',
        'Successfully filled field via CDP',
        'Field value was set correctly',
        'Returned result indicating action was taken',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify username field was empty before action',
          "Check that field now contains 'testuser' text",
        ],
      },
    },
  },
  metadata: {
    tags: ['tool', 'objective-action', 'cdp', 'form-fill', 'input'],
    timeout: 60000,
  },
};

// ============================================================================
// GetPageContent Search Tests (4)
// ============================================================================

export interface GetPageContentArgs {
  reasoning: string;
  searchQuery?: string;
  focusElementId?: string;
  fullPage?: boolean;
  chunkIndex?: number;
}

export const getPageContentSearchBasicTest: TestCase<GetPageContentArgs> = {
  id: 'tool-get-page-content-search-001',
  name: 'Get Page Content - Search Elements on Simple Page',
  description: 'Test searchQuery to find elements by text content on a simple page',
  url: 'https://the-internet.herokuapp.com/',
  tool: 'get_page_content',
  input: {
    reasoning: 'Testing element search functionality on simple page',
    searchQuery: 'link',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool returned a matches array (not empty)',
        'Each match has an id field',
        'Each match has a context field showing surrounding lines',
        'Matches contain elements related to links',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: false,
        verificationPrompts: [
          'Verify the-internet.herokuapp.com homepage loaded with links',
        ],
      },
    },
  },
  metadata: {
    tags: ['tool', 'get-page-content', 'search', 'accessibility'],
    timeout: 30000,
  },
};

export const getPageContentSearchAmazonTest: TestCase<GetPageContentArgs> = {
  id: 'tool-get-page-content-search-002',
  name: 'Get Page Content - Search on Complex Amazon Page',
  description: 'Test searchQuery works on complex Amazon search results page with shadow DOM',
  url: 'https://www.amazon.com/s?k=headphones',
  tool: 'get_page_content',
  input: {
    reasoning: 'Testing element search on complex Amazon page with shadow DOM',
    searchQuery: 'headphones',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool returned a matches array',
        'Matches contain product-related elements mentioning headphones',
        'Search worked despite complex DOM structure',
        'Each match includes context showing surrounding accessibility tree',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: false,
        verificationPrompts: [
          'Verify Amazon search results page loaded with headphones products',
        ],
      },
    },
  },
  metadata: {
    tags: ['tool', 'get-page-content', 'search', 'amazon', 'complex'],
    timeout: 60000,
    flaky: true,
  },
};

export const getPageContentSearchReviewsTest: TestCase<GetPageContentArgs> = {
  id: 'tool-get-page-content-search-003',
  name: 'Get Page Content - Search for Reviews',
  description: 'Test searchQuery to find review-related elements on Amazon product page',
  url: 'https://www.amazon.com/dp/B09B8V1LZ3',
  tool: 'get_page_content',
  input: {
    reasoning: 'Testing search for review elements on product page',
    searchQuery: 'review',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool returned matches array',
        'Matches contain review-related elements',
        'Found elements like "reviews", "customer reviews", or rating-related text',
        'Context field shows surrounding accessibility tree structure',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: false,
        verificationPrompts: [
          'Verify Amazon product page loaded with reviews section',
        ],
      },
    },
  },
  metadata: {
    tags: ['tool', 'get-page-content', 'search', 'amazon', 'reviews'],
    timeout: 60000,
    flaky: true,
  },
};

export const getPageContentSearchNoResultsTest: TestCase<GetPageContentArgs> = {
  id: 'tool-get-page-content-search-004',
  name: 'Get Page Content - No Results Graceful Handling',
  description: 'Test searchQuery returns empty array gracefully when no matches found',
  url: 'https://the-internet.herokuapp.com/',
  tool: 'get_page_content',
  input: {
    reasoning: 'Testing graceful handling when search finds no matches',
    searchQuery: 'xyznonexistent123abcdef',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Tool returned a result without error',
        'matches array is empty or totalMatches is 0',
        'Tool handled no-results case gracefully',
        'Response includes simplified message about zero matches',
      ],
      visualVerification: {
        enabled: false,
        captureBeforeAction: false,
        captureAfterAction: false,
        verificationPrompts: [],
      },
    },
  },
  metadata: {
    tags: ['tool', 'get-page-content', 'search', 'edge-case', 'no-results'],
    timeout: 30000,
  },
};

/**
 * All GetPageContent search tests
 */
export const getPageContentSearchTests: TestCase<GetPageContentArgs>[] = [
  getPageContentSearchBasicTest,
  getPageContentSearchAmazonTest,
  getPageContentSearchReviewsTest,
  getPageContentSearchNoResultsTest,
];

// ============================================================================
// Exported Test Collections
// ============================================================================

/**
 * All NavigateBackTool tests
 */
export const navigateBackToolTests: TestCase<NavigateBackArgs>[] = [
  navigateBackEcommerceTest,
  navigateBackNewsMultiStepTest,
  navigateBackHistoryBoundaryTest,
];

/**
 * All ExecuteCodeTool tests
 */
export const executeCodeToolTests: TestCase<ExecuteCodeArgs>[] = [
  executeCodeProductExtractionTest,
  executeCodeMetadataTest,
  executeCodeNavigationLinksTest,
  executeCodeFormFieldsTest,
  executeCodeTableDataTest,
  executeCodeBookCatalogTest,
];

/**
 * All HybridAccessibilityTreeTool tests
 */
export const hybridA11yToolTests: TestCase<HybridAccessibilityTreeArgs>[] = [
  hybridA11yComplexInteractiveTest,
  hybridA11yShadowDOMTest,
  hybridA11yMultiFrameTest,
  hybridA11yFormHeavyTest,
  hybridA11ySPADynamicTest,
];

/**
 * All WaitTool tests
 */
export const waitToolTests: TestCase<WaitArgs>[] = [
  waitBasicTest,
  waitDurationAliasTest,
  waitBelowMinimumTest,
  waitAboveMaximumTest,
];

/**
 * All NodeIDsToURLsTool tests
 */
export const nodeIdsToUrlsToolTests: TestCase<NodeIDsToURLsArgs>[] = [
  nodeIdsToUrlsValidTest,
  nodeIdsToUrlsEmptyArrayTest,
  nodeIdsToUrlsInvalidIdsTest,
];

/**
 * All NetworkAnalysisTool tests
 */
export const networkAnalysisToolTests: TestCase<NetworkAnalysisArgs>[] = [
  networkAnalysisBrowserOnlyTest,
];

/**
 * All ObjectiveDrivenActionTool tests
 */
export const objectiveActionToolTests: TestCase<ObjectiveDrivenActionArgs>[] = [
  objectiveActionClickTest,
  objectiveActionFormFillTest,
];

/**
 * All CDP tool tests combined
 */
export const cdpToolTests = [
  ...navigateBackToolTests,
  ...executeCodeToolTests,
  ...hybridA11yToolTests,
  ...waitToolTests,
  ...nodeIdsToUrlsToolTests,
  ...networkAnalysisToolTests,
  ...objectiveActionToolTests,
  ...getPageContentSearchTests,
];
