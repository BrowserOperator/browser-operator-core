// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Central index for all evaluation test cases.
 * Import from here to get all available tests.
 */

// ActionAgent Tests
export {
  actionAgentTests,
  getBasicActionTests,
  getActionTestsByType,
  basicClickTest,
  formFillTest,
  navigationClickTest,
  ecommerceActionTest,
  checkboxActionTest,
  toggleCheckboxTest,
  radioButtonTest,
  dropdownActionTest,
  multiStepFormTest,
  dynamicContentTest,
  loginFormTest,
  hoverActionTest,
  accessibilityActionTest,
  errorRecoveryTest,
  datePickerTest,
  datePickerFillTest,
  dateRangePickerTest,
  timePickerTest,
  fileUploadTest,
  modalDialogTest,
  sliderTest,
  multiSelectTest,
  autocompleteTest,
  tabPanelTest,
  accordionTest,
  tableSortTest,
  tableSelectTest,
  videoControlsTest,
  videoPlayButtonTest,
  keyboardNavTest,
  searchFilterTest,
  loginFormWithSubmitTest,
  herokuCheckboxToggleTest,
} from './action-agent-tests.js';

// ActionAgent Shadow DOM Tests
export {
  shadowDOMActionTests,
  shadowClickOpenTest,
  shadowClickClosedTest,
  shadowNestedClickTest,
  githubSearchShadowTest,
  shadowCustomSelectTest,
} from './action-agent-shadow-dom-tests.js';

// ActionAgent Iframe Tests
export {
  iframeActionTests,
  encodedIdActionTests,
  iframeBasicClickTest,
  iframeNestedTest,
  iframeShadowComboTest,
  youtubeVideoControlsTest,
  iframeFormFillTest,
  iframeHopNotationTest,
  encodedIdClickTest,
  encodedIdCrossFrameTest,
} from './action-agent-iframe-tests.js';

// WebTaskAgent Shadow DOM Tests
export {
  webTaskAgentShadowDOMTests,
  shadowDomFormWorkflowTest,
  githubIssueCreationTest,
  notionBlockEditingTest,
  shadowDomShoppingTest,
  shadowDomVideoPlayerTest,
} from './web-task-agent-shadow-dom-tests.js';

// WebTaskAgent Iframe Tests
export {
  webTaskAgentIframeTests,
  hybridSnapshotTests,
  bookingWidgetIframeTest,
  paymentGatewayIframeTest,
  googleDocsEditingTest,
  airlineBookingAnaTest,
  embeddedSurveyIframeTest,
  embeddedMapWidgetTest,
  dashboardMultiIframeTest,
  multiFrameExtractionTest,
  encodedIdWorkflowTest,
} from './web-task-agent-iframe-tests.js';

// Research Agent Tests
export {researchAgentTests} from './research-agent-tests.js';

// Schema Extractor Tests
export {schemaExtractorTests} from './schema-extractor-tests.js';

// Streamlined Schema Extractor Tests
export {streamlinedSchemaExtractorTests} from './streamlined-schema-extractor-tests.js';

// HTML to Markdown Tests
export {htmlToMarkdownTests} from './html-to-markdown-tests.js';

// Note: screenshot-verification-test.ts is a utility function, not a TestCase array
// and has pre-existing issues - import directly if needed

// WebTaskAgent Tests
export {webTaskAgentTests} from './web-task-agent-tests.js';

// CDP Tool Tests
export {
  cdpToolTests,
  navigateBackToolTests,
  executeCodeToolTests,
  hybridA11yToolTests,
  waitToolTests,
  nodeIdsToUrlsToolTests,
  networkAnalysisToolTests,
  objectiveActionToolTests,
  // Individual tests
  navigateBackEcommerceTest,
  navigateBackNewsMultiStepTest,
  navigateBackHistoryBoundaryTest,
  executeCodeProductExtractionTest,
  executeCodeMetadataTest,
  executeCodeNavigationLinksTest,
  executeCodeFormFieldsTest,
  executeCodeTableDataTest,
  executeCodeBookCatalogTest,
  hybridA11yComplexInteractiveTest,
  hybridA11yShadowDOMTest,
  hybridA11yMultiFrameTest,
  hybridA11yFormHeavyTest,
  hybridA11ySPADynamicTest,
  waitBasicTest,
  waitDurationAliasTest,
  waitBelowMinimumTest,
  waitAboveMaximumTest,
  nodeIdsToUrlsValidTest,
  nodeIdsToUrlsEmptyArrayTest,
  nodeIdsToUrlsInvalidIdsTest,
  networkAnalysisBrowserOnlyTest,
  objectiveActionClickTest,
  objectiveActionFormFillTest,
} from './cdp-tool-tests.js';

// ============================================================================
// Combined Test Collections
// ============================================================================

import {actionAgentTests} from './action-agent-tests.js';
import {shadowDOMActionTests} from './action-agent-shadow-dom-tests.js';
import {iframeActionTests, encodedIdActionTests} from './action-agent-iframe-tests.js';
import {webTaskAgentShadowDOMTests} from './web-task-agent-shadow-dom-tests.js';
import {webTaskAgentIframeTests, hybridSnapshotTests} from './web-task-agent-iframe-tests.js';
import {webTaskAgentTests} from './web-task-agent-tests.js';
import {researchAgentTests} from './research-agent-tests.js';
import {schemaExtractorTests} from './schema-extractor-tests.js';
import {streamlinedSchemaExtractorTests} from './streamlined-schema-extractor-tests.js';
import {htmlToMarkdownTests} from './html-to-markdown-tests.js';
import {cdpToolTests} from './cdp-tool-tests.js';
// testScreenshotVerification is a function, not a TestCase array - not included in allTests

/**
 * All ActionAgent tests including shadow DOM and iframe tests.
 */
export const allActionAgentTests = [
  ...actionAgentTests,
  ...shadowDOMActionTests,
  ...iframeActionTests,
  ...encodedIdActionTests,
];

/**
 * All WebTaskAgent tests including shadow DOM and iframe tests.
 */
export const allWebTaskAgentTests = [
  ...webTaskAgentTests,
  ...webTaskAgentShadowDOMTests,
  ...webTaskAgentIframeTests,
  ...hybridSnapshotTests,
];

/**
 * All available test cases across all agents and tools.
 */
export const allTests = [
  ...allActionAgentTests,
  ...allWebTaskAgentTests,
  ...researchAgentTests,
  ...schemaExtractorTests,
  ...streamlinedSchemaExtractorTests,
  ...htmlToMarkdownTests,
  ...cdpToolTests,
];

/**
 * Get tests filtered by tag.
 */
export function getTestsByTag(tag: string) {
  return allTests.filter(test =>
    test.metadata?.tags?.includes(tag)
  );
}

/**
 * Get tests filtered by tool name.
 */
export function getTestsByTool(toolName: string) {
  return allTests.filter(test => test.tool === toolName);
}

/**
 * Get Shadow DOM specific tests (ActionAgent + WebTaskAgent).
 */
export function getShadowDOMTests() {
  return [
    ...shadowDOMActionTests,
    ...webTaskAgentShadowDOMTests,
  ];
}

/**
 * Get Iframe specific tests (ActionAgent + WebTaskAgent).
 */
export function getIframeTests() {
  return [
    ...iframeActionTests,
    ...webTaskAgentIframeTests,
  ];
}

/**
 * Get EncodedId/hybrid snapshot tests.
 */
export function getEncodedIdTests() {
  return [
    ...encodedIdActionTests,
    ...hybridSnapshotTests,
  ];
}

/**
 * Get CDP tool tests.
 */
export function getCDPToolTests() {
  return cdpToolTests;
}
