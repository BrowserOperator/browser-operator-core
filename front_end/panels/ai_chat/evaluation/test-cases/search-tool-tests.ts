// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type { TestCase } from '../framework/types.js';

export interface SearchToolArgs {
  query: string;
  site: string;
  reasoning: string;
  maxResults?: number;
  forceRefresh?: boolean;
  strategy?: 'xpath-schema' | 'semantic-xpath' | 'encoded-id' | 'text-pattern' | 'cdp' | 'js-eval';
}

// Google Search Test
export const googleSearchTest: TestCase<SearchToolArgs> = {
  id: 'search-tool-google-001',
  name: 'Google Search Basic',
  description: 'Test searching Google and extracting results',
  url: 'https://www.google.com',
  tool: 'search',
  input: {
    query: 'react hooks tutorial',
    site: 'google.com',
    reasoning: 'Testing basic Google search extraction',
    maxResults: 5,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Successfully navigated to Google search results',
        'Extracted at least 3 search results',
        'Each result has a title and URL',
        'URLs are valid and related to "react hooks"',
        'Results have snippet/description text',
        'Results are ordered by position',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        verificationPrompts: [
          'Verify Google search results page is displayed',
          'Check that results are related to "react hooks tutorial"',
        ],
      },
    },
  },
  metadata: {
    tags: ['search', 'google', 'basic', 'extraction'],
    timeout: 60000,
    retries: 2,
  },
};

// Bing Search Test
export const bingSearchTest: TestCase<SearchToolArgs> = {
  id: 'search-tool-bing-001',
  name: 'Bing Search Basic',
  description: 'Test searching Bing and extracting results',
  url: 'https://www.bing.com',
  tool: 'search',
  input: {
    query: 'typescript best practices',
    site: 'bing.com',
    reasoning: 'Testing Bing search extraction',
    maxResults: 5,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Successfully navigated to Bing search results',
        'Extracted at least 3 search results',
        'Each result has a title and URL',
        'Results are related to "typescript best practices"',
        'Results have snippet text',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
      },
    },
  },
  metadata: {
    tags: ['search', 'bing', 'basic', 'extraction'],
    timeout: 60000,
    retries: 2,
  },
};

// Wikipedia Search Test
// Note: Query must NOT exactly match an article name, otherwise Wikipedia redirects to the article
export const wikipediaSearchTest: TestCase<SearchToolArgs> = {
  id: 'search-tool-wikipedia-001',
  name: 'Wikipedia Search',
  description: 'Test searching Wikipedia and extracting results',
  url: 'https://en.wikipedia.org',
  tool: 'search',
  input: {
    query: 'machine learning algorithms comparison',  // Query that produces search results, not a redirect
    site: 'wikipedia.org',
    reasoning: 'Testing Wikipedia search extraction',
    maxResults: 5,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Successfully navigated to Wikipedia search results page',
        'Extracted search results',
        'Each result has a title and URL',
        'URLs point to Wikipedia articles (contain wikipedia.org/wiki/)',
        'Results are related to machine learning',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
      },
    },
  },
  metadata: {
    tags: ['search', 'wikipedia', 'basic', 'extraction'],
    timeout: 60000,
    retries: 2,
  },
};

// GitHub Search Test
export const githubSearchTest: TestCase<SearchToolArgs> = {
  id: 'search-tool-github-001',
  name: 'GitHub Repository Search',
  description: 'Test searching GitHub repositories and extracting results',
  url: 'https://github.com',
  tool: 'search',
  input: {
    query: 'react component library',
    site: 'github.com',
    reasoning: 'Testing GitHub repository search extraction',
    maxResults: 5,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Successfully navigated to GitHub search results',
        'Extracted repository results',
        'Each result has a title and URL',
        'URLs point to GitHub repositories',
        'Results are related to "react component library"',
        'Results include star count or language info (if available)',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
      },
    },
  },
  metadata: {
    tags: ['search', 'github', 'basic', 'extraction'],
    timeout: 90000,
    retries: 2,
  },
};

// Amazon Search Test
export const amazonSearchTest: TestCase<SearchToolArgs> = {
  id: 'search-tool-amazon-001',
  name: 'Amazon Product Search',
  description: 'Test searching Amazon and extracting product results',
  url: 'https://www.amazon.com',
  tool: 'search',
  input: {
    query: 'wireless earbuds',
    site: 'amazon.com',
    reasoning: 'Testing Amazon product search extraction',
    maxResults: 5,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Successfully navigated to Amazon search results',
        'Extracted product results',
        'Each result has a title and URL',
        'URLs point to Amazon product pages',
        'Results are related to "wireless earbuds"',
        'Results include price information (if available)',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
      },
    },
  },
  metadata: {
    tags: ['search', 'amazon', 'ecommerce', 'extraction'],
    timeout: 90000,
    retries: 3,
    flaky: true, // E-commerce sites can be dynamic
  },
};

// Pattern Caching Test
export const patternCachingTest: TestCase<SearchToolArgs> = {
  id: 'search-tool-cache-001',
  name: 'Pattern Caching Verification',
  description: 'Test that second search uses cached pattern',
  url: 'https://www.google.com',
  tool: 'search',
  input: {
    query: 'javascript async await',
    site: 'google.com',
    reasoning: 'Testing pattern caching behavior',
    maxResults: 3,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Search completed successfully',
        'Extracted search results',
        'Pattern was either cached from previous run or newly generated',
        'Results are related to the query',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
      },
    },
  },
  metadata: {
    tags: ['search', 'caching', 'google', 'performance'],
    timeout: 60000,
    retries: 1,
  },
};

// Force Refresh Test
export const forceRefreshTest: TestCase<SearchToolArgs> = {
  id: 'search-tool-refresh-001',
  name: 'Force Pattern Refresh',
  description: 'Test forcing pattern regeneration',
  url: 'https://www.google.com',
  tool: 'search',
  input: {
    query: 'python data science',
    site: 'google.com',
    reasoning: 'Testing force refresh pattern generation',
    maxResults: 3,
    forceRefresh: true,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Search completed successfully',
        'Pattern was regenerated (not from cache)',
        'Extracted search results',
        'Results are related to "python data science"',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
      },
    },
  },
  metadata: {
    tags: ['search', 'refresh', 'google', 'pattern-generation'],
    timeout: 90000,
    retries: 2,
  },
};

// Max Results Limit Test
export const maxResultsTest: TestCase<SearchToolArgs> = {
  id: 'search-tool-maxresults-001',
  name: 'Max Results Limit',
  description: 'Test limiting maximum results returned',
  url: 'https://www.google.com',
  tool: 'search',
  input: {
    query: 'node.js express tutorial',
    site: 'google.com',
    reasoning: 'Testing max results limit',
    maxResults: 3,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Search completed successfully',
        'Returned at most 3 results',
        'Each result has title and URL',
        'Results are properly ordered',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
      },
    },
  },
  metadata: {
    tags: ['search', 'google', 'limit', 'basic'],
    timeout: 60000,
    retries: 2,
  },
};

// Unknown Site Test (should generate pattern dynamically)
export const unknownSiteTest: TestCase<SearchToolArgs> = {
  id: 'search-tool-unknown-001',
  name: 'Unknown Site Search',
  description: 'Test searching a site without predefined configuration',
  url: 'https://duckduckgo.com',
  tool: 'search',
  input: {
    query: 'web development frameworks',
    site: 'duckduckgo.com',
    reasoning: 'Testing search on unknown site',
    maxResults: 5,
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Attempted to search the site',
        'Generated a pattern for the unknown site',
        'Either succeeded in extraction or provided meaningful error',
        'Did not crash or hang',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
      },
    },
  },
  metadata: {
    tags: ['search', 'unknown-site', 'dynamic', 'pattern-generation'],
    timeout: 120000,
    retries: 2,
    flaky: true, // Unknown sites may vary
  },
};

// All search tool tests
export const searchToolTests: TestCase<SearchToolArgs>[] = [
  googleSearchTest,
  bingSearchTest,
  wikipediaSearchTest,
  githubSearchTest,
  amazonSearchTest,
  patternCachingTest,
  forceRefreshTest,
  maxResultsTest,
  unknownSiteTest,
];

// Get basic tests for quick validation
export function getBasicSearchTests(): TestCase<SearchToolArgs>[] {
  return [googleSearchTest, bingSearchTest, wikipediaSearchTest];
}

// Get tests by site
export function getSearchTestsBySite(site: string): TestCase<SearchToolArgs>[] {
  return searchToolTests.filter(test =>
    test.input.site.toLowerCase().includes(site.toLowerCase())
  );
}
