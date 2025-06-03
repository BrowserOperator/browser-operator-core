// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as i18n from '../../../core/i18n/i18n.js';
import * as UI from '../../../ui/legacy/legacy.js';
import { EvaluationRunner } from '../evaluation/example-runner.js';
import { VisionAgentEvaluationRunner } from '../evaluation/VisionAgentEvaluationRunner.js';
import { MarkdownReportGenerator } from '../evaluation/framework/MarkdownReportGenerator.js';
import { MarkdownViewerUtil } from '../common/MarkdownViewerUtil.js';
import { schemaExtractorTests } from '../evaluation/test-cases/schema-extractor-tests.js';
import { researchAgentTests, getBasicResearchTests } from '../evaluation/test-cases/research-agent-tests.js';
import { actionAgentTests, getBasicActionTests } from '../evaluation/test-cases/action-agent-tests.js';
import type { TestResult } from '../evaluation/framework/types.js';

const UIStrings = {
  /**
   * @description Title of the evaluation dialog
   */
  evaluationTests: 'Evaluation Tests',
  /**
   * @description Button to run a single test
   */
  runTest: 'Run Test',
  /**
   * @description Button to run all tests
   */
  runAllTests: 'Run All Tests',
  /**
   * @description Test status: passed
   */
  testPassed: 'PASSED',
  /**
   * @description Test status: failed
   */
  testFailed: 'FAILED',
  /**
   * @description Test status: error
   */
  testError: 'ERROR',
  /**
   * @description Test status: running
   */
  testRunning: 'RUNNING',
  /**
   * @description No tests have been run yet
   */
  noTestResults: 'No tests have been run yet',
  /**
   * @description Close dialog button
   */
  close: 'Close',
  /**
   * @description Progress indicator
   */
  progress: 'Progress',
  /**
   * @description Test results summary
   */
  summary: 'Test Summary',
  /**
   * @description Clear results button
   */
  clearResults: 'Clear Results',
  /**
   * @description Tab for schema extractor tests
   */
  schemaExtractorTests: 'Schema Extractor Tests',
  /**
   * @description Tab for agent tests
   */
  agentTests: 'Agent Tests',
  /**
   * @description Run basic agent tests button
   */
  runBasicAgentTests: 'Run Basic Agent Tests',
  /**
   * @description Run all agent tests button
   */
  runAllAgentTests: 'Run All Agent Tests',
  /**
   * @description Run action agent tests button
   */
  runActionAgentTests: 'Run Action Agent Tests',
  /**
   * @description View detailed report button
   */
  viewDetailedReport: 'View Detailed Report',
  /**
   * @description Enable vision verification checkbox
   */
  enableVisionVerification: 'Enable Vision Verification',
  /**
   * @description Vision verification tooltip
   */
  visionVerificationTooltip: 'Uses GPT-4 Vision to analyze screenshots for visual confirmation of actions',
  /**
   * @description Test logs header
   */
  testLogs: 'Test Logs',
} as const;

const str_ = i18n.i18n.registerUIStrings('panels/ai_chat/ui/EvaluationDialog.ts', UIStrings);
const i18nString = i18n.i18n.getLocalizedString.bind(undefined, str_);

interface EvaluationDialogState {
  isRunning: boolean;
  testResults: Map<string, TestResult>;
  currentRunningTest?: string;
  totalTests: number;
  completedTests: number;
  startTime?: number;
  activeTab: 'schema-extractor' | 'agents';
  agentType?: 'research' | 'action';
  visionEnabled?: boolean;
  selectedTests: Set<string>;
  bottomPanelView: 'summary' | 'logs';
  testLogs: string[];
}

export class EvaluationDialog {
  #state: EvaluationDialogState = {
    isRunning: false,
    testResults: new Map(),
    totalTests: 0,
    completedTests: 0,
    activeTab: 'schema-extractor',
    agentType: 'research',
    visionEnabled: false,
    selectedTests: new Set(),
    bottomPanelView: 'summary',
    testLogs: [],
  };
  
  #evaluationRunner?: EvaluationRunner;
  #agentEvaluationRunner?: VisionAgentEvaluationRunner;
  #dialog: UI.Dialog.Dialog;

  static show(): void {
    new EvaluationDialog();
  }

  constructor() {
    this.#dialog = new UI.Dialog.Dialog();
    this.#dialog.setDimmed(true);
    this.#dialog.setOutsideClickCallback(() => this.#dialog.hide());
    this.#dialog.contentElement.classList.add('evaluation-dialog');
    this.#dialog.contentElement.style.width = '800px';
    this.#dialog.contentElement.style.height = '600px';
    this.#dialog.contentElement.style.padding = '0';
    this.#dialog.contentElement.style.display = 'flex';
    this.#dialog.contentElement.style.flexDirection = 'column';
    
    // Initialize evaluation runners
    try {
      this.#evaluationRunner = new EvaluationRunner();
    } catch (error) {
      console.error('Failed to initialize evaluation runner:', error);
    }
    
    try {
      this.#agentEvaluationRunner = new VisionAgentEvaluationRunner(this.#state.visionEnabled);
    } catch (error) {
      console.error('Failed to initialize agent evaluation runner:', error);
    }

    this.#addStyles();
    this.#render();
    this.#dialog.show();
  }

  #addStyles(): void {
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      .evaluation-dialog {
        font-family: var(--default-font-family);
        background: var(--sys-color-cdt-base-container);
        color: var(--sys-color-on-surface);
      }
      
      .eval-header {
        background: var(--sys-color-surface-variant);
        padding: 20px;
        border-bottom: 1px solid var(--sys-color-divider);
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .eval-title {
        margin: 0;
        font-size: 18px;
        font-weight: 500;
        color: var(--sys-color-on-surface);
      }
      
      .eval-status {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 12px;
        color: var(--sys-color-on-surface-variant);
      }
      
      .eval-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 20px;
        overflow: hidden;
        min-height: 0;
      }
      
      .eval-tests-panel {
        flex: 0 0 60%;
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
      }
      
      .eval-bottom-panel {
        flex: 0 0 40%;
        display: flex;
        flex-direction: column;
        background: var(--sys-color-surface);
        border-radius: 8px;
        border: 1px solid var(--sys-color-divider);
        overflow: hidden;
      }
      
      .eval-bottom-tabs {
        display: flex;
        background: var(--sys-color-surface-variant);
        border-bottom: 1px solid var(--sys-color-divider);
      }
      
      .eval-bottom-tab {
        padding: 8px 16px;
        background: transparent;
        border: none;
        color: var(--sys-color-on-surface-variant);
        cursor: pointer;
        font-size: 13px;
        border-bottom: 2px solid transparent;
        transition: all 0.2s ease;
      }
      
      .eval-bottom-tab:hover {
        background: var(--sys-color-state-hover-on-subtle);
      }
      
      .eval-bottom-tab.active {
        color: var(--sys-color-primary);
        border-bottom-color: var(--sys-color-primary);
        font-weight: 500;
      }
      
      .eval-bottom-content {
        flex: 1;
        padding: 16px;
        overflow-y: auto;
        min-height: 0;
      }
      
      .eval-logs-container {
        font-family: var(--monospace-font-family);
        font-size: 12px;
        line-height: 1.6;
        white-space: pre-wrap;
        word-break: break-word;
        color: var(--sys-color-on-surface-variant);
      }
      
      .eval-log-entry {
        margin-bottom: 4px;
        padding: 2px 0;
      }
      
      .eval-log-entry.info {
        color: var(--sys-color-on-surface);
      }
      
      .eval-log-entry.success {
        color: var(--sys-color-green);
      }
      
      .eval-log-entry.warning {
        color: var(--sys-color-yellow);
      }
      
      .eval-log-entry.error {
        color: var(--sys-color-error);
      }
      
      .eval-progress-bar {
        width: 100%;
        height: 4px;
        background: var(--sys-color-surface-variant);
        border-radius: 2px;
        overflow: hidden;
        margin: 8px 0;
      }
      
      .eval-progress-fill {
        height: 100%;
        background: var(--sys-color-primary);
        transition: width 0.3s ease;
        border-radius: 2px;
      }
      
      .eval-test-list {
        border: 1px solid var(--sys-color-divider);
        border-radius: 8px;
        overflow-y: auto;
        overflow-x: hidden;
        flex: 1;
        min-height: 0;
      }
      
      .eval-test-list::-webkit-scrollbar {
        width: 8px;
      }
      
      .eval-test-list::-webkit-scrollbar-track {
        background: var(--sys-color-surface-variant);
        border-radius: 4px;
      }
      
      .eval-test-list::-webkit-scrollbar-thumb {
        background: var(--sys-color-outline);
        border-radius: 4px;
      }
      
      .eval-test-list::-webkit-scrollbar-thumb:hover {
        background: var(--sys-color-on-surface-variant);
      }
      
      .eval-test-item {
        padding: 16px;
        border-bottom: 1px solid var(--sys-color-divider);
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        transition: background-color 0.2s ease;
        min-height: 80px;
      }
      
      .eval-test-item:hover {
        background: var(--sys-color-state-hover-on-subtle);
        cursor: pointer;
      }
      
      .eval-test-item.selected {
        background: var(--sys-color-tonal-container);
        border-left: 3px solid var(--sys-color-primary);
        padding-left: 13px;
      }
      
      .eval-test-item.selected:hover {
        background: var(--sys-color-state-hover-on-prominent);
      }
      
      .eval-test-item.running {
        background: var(--sys-color-surface-yellow);
        animation: pulse 2s infinite;
      }
      
      .eval-test-item.passed {
        background: var(--sys-color-surface-green);
      }
      
      .eval-test-item.failed {
        background: var(--sys-color-surface-yellow);
      }
      
      .eval-test-item.error {
        background: var(--sys-color-surface-error);
      }
      
      .eval-test-item.selected.passed {
        background: var(--sys-color-surface-green);
        border-left-color: var(--sys-color-primary);
      }
      
      .eval-test-item.selected.failed {
        background: var(--sys-color-surface-yellow);
        border-left-color: var(--sys-color-primary);
      }
      
      .eval-test-item.selected.error {
        background: var(--sys-color-surface-error);
        border-left-color: var(--sys-color-primary);
      }
      
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
      }
      
      .eval-test-info {
        flex: 1;
        min-width: 0;
        overflow: hidden;
      }
      
      .eval-test-name {
        font-weight: 500;
        font-size: 14px;
        margin-bottom: 4px;
        color: var(--sys-color-on-surface);
      }
      
      .eval-test-url {
        font-size: 12px;
        color: var(--sys-color-on-surface-variant);
        font-family: var(--monospace-font-family);
        margin-bottom: 8px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }
      
      .eval-test-details {
        font-size: 12px;
        color: var(--sys-color-on-surface-variant);
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
      }
      
      .eval-test-status {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 500;
        font-size: 12px;
        min-width: 90px;
        max-width: 120px;
        justify-content: flex-end;
        flex-shrink: 0;
      }
      
      .eval-status-icon {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        font-weight: bold;
      }
      
      .eval-status-icon.running {
        background: var(--sys-color-primary);
        color: var(--sys-color-on-primary);
        animation: spin 1s linear infinite;
      }
      
      .eval-status-icon.passed {
        background: var(--sys-color-green);
        color: white;
      }
      
      .eval-status-icon.failed {
        background: var(--sys-color-yellow);
        color: white;
      }
      
      .eval-status-icon.error {
        background: var(--sys-color-error);
        color: white;
      }
      
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      
      .eval-summary-item {
        display: flex;
        justify-content: space-between;
        margin-bottom: 8px;
        font-size: 13px;
      }
      
      .eval-summary-label {
        color: var(--sys-color-on-surface-variant);
      }
      
      .eval-summary-value {
        font-weight: 500;
        color: var(--sys-color-on-surface);
      }
      
      .eval-buttons {
        padding: 20px;
        border-top: 1px solid var(--sys-color-divider);
        display: flex;
        gap: 12px;
        justify-content: flex-end;
        background: var(--sys-color-surface-variant);
      }
      
      .eval-button {
        padding: 8px 16px;
        border: 1px solid var(--sys-color-outline);
        border-radius: 4px;
        background: var(--sys-color-surface);
        color: var(--sys-color-on-surface);
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      
      .eval-button:hover:not(:disabled) {
        background: var(--sys-color-state-hover-on-subtle);
      }
      
      .eval-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      
      .eval-button.primary {
        background: var(--sys-color-primary);
        color: var(--sys-color-on-primary);
        border-color: var(--sys-color-primary);
      }
      
      .eval-button.primary:hover:not(:disabled) {
        background: var(--sys-color-primary-bright);
      }
      
      .eval-empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 200px;
        color: var(--sys-color-on-surface-variant);
        font-size: 14px;
      }
      
      .eval-empty-icon {
        font-size: 48px;
        margin-bottom: 16px;
        opacity: 0.5;
      }
      
      .eval-tabs {
        display: flex;
        border-bottom: 1px solid var(--sys-color-divider);
        margin-bottom: 16px;
      }
      
      .eval-tab {
        padding: 8px 16px;
        background: transparent;
        border: none;
        color: var(--sys-color-on-surface-variant);
        cursor: pointer;
        font-size: 13px;
        border-bottom: 2px solid transparent;
        transition: all 0.2s ease;
      }
      
      .eval-tab:hover {
        background: var(--sys-color-state-hover-on-subtle);
      }
      
      .eval-tab.active {
        color: var(--sys-color-primary);
        border-bottom-color: var(--sys-color-primary);
        font-weight: 500;
      }
      
      .eval-tag.agent {
        background: #6f42c1 !important;
      }
      
      .eval-tag.research {
        background: #17a2b8 !important;
      }
      
      .eval-tag.basic {
        background: #28a745 !important;
      }
      
      .eval-tag.technical {
        background: #dc3545 !important;
      }
      
      .eval-tag.current-events {
        background: #fd7e14 !important;
      }
      
      .eval-tag.comparison {
        background: #6610f2 !important;
      }
    `;
    this.#dialog.contentElement.appendChild(styleElement);
  }

  #render(): void {
    // Clear content but keep styles
    const existingStyle = this.#dialog.contentElement.querySelector('style');
    this.#dialog.contentElement.innerHTML = '';
    if (existingStyle) {
      this.#dialog.contentElement.appendChild(existingStyle);
    }

    // Header
    const header = this.#renderHeader();
    this.#dialog.contentElement.appendChild(header);

    // Content area
    const content = this.#renderContent();
    this.#dialog.contentElement.appendChild(content);

    // Button area
    const buttons = this.#renderButtons();
    this.#dialog.contentElement.appendChild(buttons);
  }

  #renderHeader(): HTMLElement {
    const header = document.createElement('div');
    header.className = 'eval-header';

    const title = document.createElement('h2');
    title.className = 'eval-title';
    title.textContent = i18nString(UIStrings.evaluationTests);

    const status = document.createElement('div');
    status.className = 'eval-status';

    if (this.#state.isRunning) {
      const progressText = document.createElement('span');
      progressText.textContent = `${this.#state.completedTests}/${this.#state.totalTests} tests completed`;
      status.appendChild(progressText);

      const progressBar = document.createElement('div');
      progressBar.className = 'eval-progress-bar';
      progressBar.style.width = '120px';

      const progressFill = document.createElement('div');
      progressFill.className = 'eval-progress-fill';
      const progress = this.#state.totalTests > 0 ? (this.#state.completedTests / this.#state.totalTests) * 100 : 0;
      progressFill.style.width = `${progress}%`;

      progressBar.appendChild(progressFill);
      status.appendChild(progressBar);

      if (this.#state.startTime) {
        const elapsed = Math.round((Date.now() - this.#state.startTime) / 1000);
        const elapsedText = document.createElement('span');
        elapsedText.textContent = `${elapsed}s elapsed`;
        status.appendChild(elapsedText);
      }
    } else if (this.#state.testResults.size > 0) {
      const results = Array.from(this.#state.testResults.values());
      const passed = results.filter(r => r.status === 'passed').length;
      const failed = results.filter(r => r.status === 'failed').length;
      const errors = results.filter(r => r.status === 'error').length;

      status.innerHTML = `
        <span style="color: var(--sys-color-green);">✓ ${passed}</span>
        <span style="color: var(--sys-color-yellow);">⚠ ${failed}</span>
        <span style="color: var(--sys-color-error);">✗ ${errors}</span>
      `;
    }

    header.appendChild(title);
    header.appendChild(status);
    return header;
  }

  #renderContent(): HTMLElement {
    const content = document.createElement('div');
    content.className = 'eval-content';

    // Tests panel
    const testsPanel = document.createElement('div');
    testsPanel.className = 'eval-tests-panel';

    // Add tabs
    const tabs = this.#renderTabs();
    testsPanel.appendChild(tabs);

    // Add agent type selector if on agents tab
    if (this.#state.activeTab === 'agents') {
      const agentSelector = this.#renderAgentSelector();
      testsPanel.appendChild(agentSelector);
    }

    // Add selection controls
    const selectionControls = this.#renderSelectionControls();
    testsPanel.appendChild(selectionControls);

    const testList = this.#renderTestList();
    testsPanel.appendChild(testList);

    // Bottom panel (40% height) - contains tabs for summary/logs
    const bottomPanel = this.#renderBottomPanel();

    content.appendChild(testsPanel);
    content.appendChild(bottomPanel);
    return content;
  }

  #renderTabs(): HTMLElement {
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'eval-tabs';

    // Schema Extractor Tests tab
    const schemaTab = document.createElement('button');
    schemaTab.className = 'eval-tab';
    if (this.#state.activeTab === 'schema-extractor') {
      schemaTab.classList.add('active');
    }
    schemaTab.textContent = i18nString(UIStrings.schemaExtractorTests);
    schemaTab.addEventListener('click', () => {
      this.#state.activeTab = 'schema-extractor';
      this.#state.testResults.clear(); // Clear results when switching tabs
      this.#state.selectedTests.clear(); // Clear selections when switching tabs
      this.#render();
    });

    // Agent Tests tab
    const agentTab = document.createElement('button');
    agentTab.className = 'eval-tab';
    if (this.#state.activeTab === 'agents') {
      agentTab.classList.add('active');
    }
    agentTab.textContent = i18nString(UIStrings.agentTests);
    agentTab.addEventListener('click', () => {
      this.#state.activeTab = 'agents';
      this.#state.testResults.clear(); // Clear results when switching tabs
      this.#state.selectedTests.clear(); // Clear selections when switching tabs
      this.#render();
    });

    tabsContainer.appendChild(schemaTab);
    tabsContainer.appendChild(agentTab);

    return tabsContainer;
  }

  #renderAgentSelector(): HTMLElement {
    const selectorContainer = document.createElement('div');
    selectorContainer.style.cssText = 'padding: 8px 0; display: flex; align-items: center; gap: 12px;';

    const label = document.createElement('label');
    label.textContent = 'Agent Type:';
    label.style.cssText = 'font-size: 13px; color: var(--sys-color-on-surface-variant);';

    const select = document.createElement('select');
    select.style.cssText = `
      padding: 4px 8px;
      border: 1px solid var(--sys-color-outline);
      border-radius: 4px;
      background: var(--sys-color-surface);
      color: var(--sys-color-on-surface);
      font-size: 13px;
      cursor: pointer;
    `;

    // Add options
    const researchOption = document.createElement('option');
    researchOption.value = 'research';
    researchOption.textContent = 'Research Agent';
    researchOption.selected = this.#state.agentType === 'research';

    const actionOption = document.createElement('option');
    actionOption.value = 'action';
    actionOption.textContent = 'Action Agent';
    actionOption.selected = this.#state.agentType === 'action';

    select.appendChild(researchOption);
    select.appendChild(actionOption);

    // Handle selection change
    select.addEventListener('change', () => {
      this.#state.agentType = select.value as 'research' | 'action';
      this.#state.testResults.clear(); // Clear results when switching agent types
      this.#state.selectedTests.clear(); // Clear selections when switching agent types
      this.#render();
    });

    selectorContainer.appendChild(label);
    selectorContainer.appendChild(select);

    // Add vision verification checkbox (only for action agent)
    if (this.#state.agentType === 'action') {
      const visionContainer = document.createElement('div');
      visionContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-left: 16px;';
      
      const visionCheckbox = document.createElement('input');
      visionCheckbox.type = 'checkbox';
      visionCheckbox.id = 'vision-verification';
      visionCheckbox.checked = this.#state.visionEnabled || false;
      visionCheckbox.style.cssText = 'cursor: pointer;';
      
      const visionLabel = document.createElement('label');
      visionLabel.htmlFor = 'vision-verification';
      visionLabel.textContent = i18nString(UIStrings.enableVisionVerification);
      visionLabel.style.cssText = 'font-size: 13px; color: var(--sys-color-on-surface-variant); cursor: pointer;';
      visionLabel.title = i18nString(UIStrings.visionVerificationTooltip);
      
      visionCheckbox.addEventListener('change', () => {
        this.#state.visionEnabled = visionCheckbox.checked;
        console.log(`Vision verification ${this.#state.visionEnabled ? 'enabled' : 'disabled'}`);
        // Update the runner's vision mode
        if (this.#agentEvaluationRunner) {
          this.#agentEvaluationRunner.setVisionEnabled(this.#state.visionEnabled);
        }
      });
      
      visionContainer.appendChild(visionCheckbox);
      visionContainer.appendChild(visionLabel);
      selectorContainer.appendChild(visionContainer);
    }

    return selectorContainer;
  }

  #renderSelectionControls(): HTMLElement {
    const controlsContainer = document.createElement('div');
    controlsContainer.style.cssText = 'padding: 8px 0; display: flex; align-items: center; justify-content: space-between; gap: 12px;';

    // Left side - selection info
    const leftSide = document.createElement('div');
    leftSide.style.cssText = 'display: flex; align-items: center; gap: 12px;';

    const selectionInfo = document.createElement('span');
    selectionInfo.style.cssText = 'font-size: 13px; color: var(--sys-color-on-surface-variant);';
    const selectedCount = this.#state.selectedTests.size;
    
    if (selectedCount > 0) {
      selectionInfo.textContent = `${selectedCount} tests selected`;
    } else {
      selectionInfo.textContent = 'Click tests to select them';
    }

    leftSide.appendChild(selectionInfo);

    // Right side - action buttons
    const rightSide = document.createElement('div');
    rightSide.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    if (selectedCount > 0) {
      // Clear selection button
      const clearButton = document.createElement('button');
      clearButton.className = 'eval-button';
      clearButton.textContent = 'Clear Selection';
      clearButton.style.cssText = 'padding: 4px 12px; font-size: 12px;';
      clearButton.disabled = this.#state.isRunning;
      clearButton.addEventListener('click', () => {
        this.#state.selectedTests.clear();
        this.#render();
      });
      rightSide.appendChild(clearButton);

      // Run selected button
      const runSelectedButton = document.createElement('button');
      runSelectedButton.className = 'eval-button primary';
      runSelectedButton.textContent = `Run Selected (${selectedCount})`;
      runSelectedButton.style.cssText = 'padding: 4px 12px; font-size: 12px;';
      runSelectedButton.disabled = this.#state.isRunning;
      runSelectedButton.addEventListener('click', () => this.#runSelectedTests());
      rightSide.appendChild(runSelectedButton);
    }

    controlsContainer.appendChild(leftSide);
    controlsContainer.appendChild(rightSide);

    return controlsContainer;
  }

  #renderTestList(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'eval-test-list';

    // Get tests based on active tab
    let testCases;
    if (this.#state.activeTab === 'schema-extractor') {
      testCases = schemaExtractorTests;
    } else {
      // Agent tests - check which agent type
      testCases = this.#state.agentType === 'action' ? actionAgentTests : researchAgentTests;
    }

    if (testCases.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'eval-empty-state';
      emptyState.innerHTML = `
        <div class="eval-empty-icon">🧪</div>
        <div>No test cases available</div>
      `;
      container.appendChild(emptyState);
      return container;
    }

    // Render test items
    testCases.forEach(testCase => {
      const testItem = this.#renderTestItem(testCase);
      container.appendChild(testItem);
    });

    return container;
  }

  #renderTestItem(testCase: any): HTMLElement {
    const result = this.#state.testResults.get(testCase.id);
    const isRunning = this.#state.currentRunningTest === testCase.id;
    const isSelected = this.#state.selectedTests.has(testCase.id);
    
    const item = document.createElement('div');
    item.className = 'eval-test-item';
    item.title = `${testCase.description}\nTags: ${testCase.metadata.tags.join(', ')}\n\nClick to select/deselect`;
    
    if (isSelected) {
      item.classList.add('selected');
    }
    
    if (isRunning) {
      item.classList.add('running');
    } else if (result) {
      item.classList.add(result.status);
    }
    
    // Handle click for selection
    item.addEventListener('click', () => {
      // Don't select if test is currently running
      if (isRunning || this.#state.isRunning) {
        return;
      }
      
      // Toggle selection
      if (this.#state.selectedTests.has(testCase.id)) {
        this.#state.selectedTests.delete(testCase.id);
      } else {
        this.#state.selectedTests.add(testCase.id);
      }
      
      // Re-render to update UI
      this.#render();
    });

    // Test info
    const info = document.createElement('div');
    info.className = 'eval-test-info';

    const name = document.createElement('div');
    name.className = 'eval-test-name';
    name.textContent = testCase.name;

    const url = document.createElement('div');
    url.className = 'eval-test-url';
    url.textContent = testCase.url;

    const details = document.createElement('div');
    details.className = 'eval-test-details';

    // Add tags
    const tagColors: Record<string, string> = {
      'search': '#4285f4',
      'ecommerce': '#f4b400',
      'wikipedia': '#000',
      'news': '#db4437',
      'travel': '#0f9d58',
      'products': '#673ab7',
      'fashion': '#e91e63',
      'google': '#4285f4',
      'bing': '#008373',
      'homedepot': '#f96302',
      'macys': '#ce0037',
      // Agent test tags
      'agent': '#6f42c1',
      'research': '#17a2b8',
      'basic': '#28a745',
      'technical': '#dc3545',
      'current-events': '#fd7e14',
      'comparison': '#6610f2',
      'business': '#20c997',
      'controversial': '#e83e8c',
      'multi-perspective': '#6c757d',
      'tool-orchestration': '#495057',
      'edge-case': '#ffc107',
      'stable': '#28a745',
      // Action agent specific tags
      'action': '#ff6b6b',
      'click': '#4ecdc4',
      'form-fill': '#45b7d1',
      'input': '#96ceb4',
      'navigation': '#daa520',
      'checkbox': '#ee5a24',
      'dropdown': '#5f27cd',
      'select': '#00d2d3',
      'multi-step': '#ff9ff3',
      'dynamic': '#54a0ff',
      'ajax': '#48dbfb',
      'loading': '#0abde3',
      'login': '#ee5a24',
      'authentication': '#ff6348',
      'multi-field': '#ff7979',
      'hover': '#686de0',
      'mouse': '#30336b',
      'reveal': '#130f40',
      'accessibility': '#22a6b3',
      'aria': '#f0932b',
      'a11y': '#eb4d4b',
      'error-handling': '#ff7979',
      'missing-element': '#535c68',
      'recovery': '#95afc0',
      'w3schools': '#4834d4',
    };

    const primaryTags = testCase.metadata.tags.slice(0, 2);
    primaryTags.forEach((tag: string) => {
      const tagSpan = document.createElement('span');
      tagSpan.textContent = tag;
      tagSpan.style.cssText = `
        background: ${tagColors[tag] || '#666'};
        color: white;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 10px;
        white-space: nowrap;
        flex-shrink: 0;
      `;
      details.appendChild(tagSpan);
    });

    if (result) {
      const duration = document.createElement('span');
      duration.textContent = `${result.duration}ms`;
      duration.style.cssText = 'white-space: nowrap; flex-shrink: 0;';
      details.appendChild(duration);

      if (result.validation?.llmJudge?.score !== undefined) {
        const score = document.createElement('span');
        score.textContent = `Score: ${result.validation.llmJudge.score}/100`;
        score.style.cssText = 'white-space: nowrap; flex-shrink: 0;';
        details.appendChild(score);
      }

      if (result.validation?.llmJudge?.confidence !== undefined) {
        const confidence = document.createElement('span');
        confidence.textContent = `Confidence: ${result.validation.llmJudge.confidence}%`;
        confidence.style.cssText = 'white-space: nowrap; flex-shrink: 0;';
        details.appendChild(confidence);
      }
    }

    info.appendChild(name);
    info.appendChild(url);
    info.appendChild(details);

    // Status
    const status = document.createElement('div');
    status.className = 'eval-test-status';

    const statusIcon = document.createElement('div');
    statusIcon.className = 'eval-status-icon';

    const statusText = document.createElement('span');
    statusText.style.cssText = 'white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';

    if (isRunning) {
      statusIcon.classList.add('running');
      statusIcon.textContent = '⟳';
      statusText.textContent = i18nString(UIStrings.testRunning);
    } else if (result) {
      switch (result.status) {
        case 'passed':
          statusIcon.classList.add('passed');
          statusIcon.textContent = '✓';
          statusText.textContent = i18nString(UIStrings.testPassed);
          break;
        case 'failed':
          statusIcon.classList.add('failed');
          statusIcon.textContent = '⚠';
          statusText.textContent = i18nString(UIStrings.testFailed);
          break;
        case 'error':
          statusIcon.classList.add('error');
          statusIcon.textContent = '✗';
          statusText.textContent = i18nString(UIStrings.testError);
          break;
      }
    }

    status.appendChild(statusIcon);
    status.appendChild(statusText);

    item.appendChild(info);
    item.appendChild(status);

    return item;
  }

  #renderBottomPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'eval-bottom-panel';

    // Tabs for switching between summary and logs
    const tabs = document.createElement('div');
    tabs.className = 'eval-bottom-tabs';

    const summaryTab = document.createElement('button');
    summaryTab.className = 'eval-bottom-tab';
    if (this.#state.bottomPanelView === 'summary') {
      summaryTab.classList.add('active');
    }
    summaryTab.textContent = i18nString(UIStrings.summary);
    summaryTab.addEventListener('click', () => {
      this.#state.bottomPanelView = 'summary';
      this.#render();
    });

    const logsTab = document.createElement('button');
    logsTab.className = 'eval-bottom-tab';
    if (this.#state.bottomPanelView === 'logs') {
      logsTab.classList.add('active');
    }
    logsTab.textContent = i18nString(UIStrings.testLogs);
    logsTab.addEventListener('click', () => {
      this.#state.bottomPanelView = 'logs';
      this.#render();
    });

    tabs.appendChild(summaryTab);
    tabs.appendChild(logsTab);
    panel.appendChild(tabs);

    // Content area
    const content = document.createElement('div');
    content.className = 'eval-bottom-content';

    if (this.#state.bottomPanelView === 'summary') {
      content.appendChild(this.#renderSummaryContent());
    } else {
      content.appendChild(this.#renderLogsContent());
    }

    panel.appendChild(content);
    return panel;
  }

  #renderSummaryContent(): HTMLElement {
    const container = document.createElement('div');

    if (this.#state.testResults.size === 0) {
      const emptyState = document.createElement('div');
      emptyState.textContent = i18nString(UIStrings.noTestResults);
      emptyState.style.cssText = 'color: var(--sys-color-on-surface-variant); font-style: italic; text-align: center; padding: 20px;';
      container.appendChild(emptyState);
      return container;
    }

    // Summary statistics
    const results = Array.from(this.#state.testResults.values());
    const total = results.length;
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const errors = results.filter(r => r.status === 'error').length;
    const avgDuration = total > 0 ? Math.round(results.reduce((sum, r) => sum + r.duration, 0) / total) : 0;

    const withScores = results.filter(r => r.validation?.llmJudge?.score !== undefined);
    const avgScore = withScores.length > 0 ? 
      Math.round(withScores.reduce((sum, r) => sum + (r.validation?.llmJudge?.score || 0), 0) / withScores.length) : 0;

    const summaryData = [
      ['Total Tests', total.toString()],
      ['Passed', `${passed} (${Math.round(passed/total*100)}%)`],
      ['Failed', `${failed} (${Math.round(failed/total*100)}%)`],
      ['Errors', `${errors} (${Math.round(errors/total*100)}%)`],
      ['Avg Duration', `${avgDuration}ms`],
    ];

    if (avgScore > 0) {
      summaryData.push(['Avg LLM Score', `${avgScore}/100`]);
    }

    summaryData.forEach(([label, value]) => {
      const item = document.createElement('div');
      item.className = 'eval-summary-item';

      const labelEl = document.createElement('span');
      labelEl.className = 'eval-summary-label';
      labelEl.textContent = label + ':';

      const valueEl = document.createElement('span');
      valueEl.className = 'eval-summary-value';
      valueEl.textContent = value;

      item.appendChild(labelEl);
      item.appendChild(valueEl);
      container.appendChild(item);
    });

    return container;
  }

  #renderLogsContent(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'eval-logs-container';

    if (this.#state.testLogs.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.textContent = 'No logs yet. Run tests to see logs.';
      emptyState.style.cssText = 'color: var(--sys-color-on-surface-variant); font-style: italic; text-align: center; padding: 20px;';
      container.appendChild(emptyState);
      return container;
    }

    // Display logs in reverse order (newest first)
    const reversedLogs = [...this.#state.testLogs].reverse();
    reversedLogs.forEach(log => {
      const logEntry = document.createElement('div');
      logEntry.className = 'eval-log-entry';
      
      // Determine log type based on content
      if (log.includes('\u2705') || log.includes('PASSED')) {
        logEntry.classList.add('success');
      } else if (log.includes('\u26a0') || log.includes('WARNING') || log.includes('FAILED')) {
        logEntry.classList.add('warning');
      } else if (log.includes('\u274c') || log.includes('ERROR')) {
        logEntry.classList.add('error');
      } else if (log.includes('\ud83e\uddea') || log.includes('\ud83e\udd16') || log.includes('\ud83d\udcf8')) {
        logEntry.classList.add('info');
      }
      
      logEntry.textContent = log;
      container.appendChild(logEntry);
    });

    return container;
  }

  #renderButtons(): HTMLElement {
    const buttons = document.createElement('div');
    buttons.className = 'eval-buttons';

    // Clear results button
    if (this.#state.testResults.size > 0 && !this.#state.isRunning) {
      const clearButton = document.createElement('button');
      clearButton.className = 'eval-button';
      clearButton.textContent = i18nString(UIStrings.clearResults);
      clearButton.addEventListener('click', () => this.#clearResults());
      buttons.appendChild(clearButton);

      // View detailed report button
      const reportButton = document.createElement('button');
      reportButton.className = 'eval-button';
      reportButton.textContent = i18nString(UIStrings.viewDetailedReport);
      reportButton.addEventListener('click', () => this.#viewDetailedReport());
      buttons.appendChild(reportButton);
    }

    // Buttons depend on active tab
    if (this.#state.activeTab === 'schema-extractor') {
      // Run single test button
      const runTestButton = document.createElement('button');
      runTestButton.className = 'eval-button primary';
      runTestButton.textContent = `${i18nString(UIStrings.runTest)} (Simple)`;
      runTestButton.disabled = this.#state.isRunning;
      runTestButton.addEventListener('click', () => this.#runSingleTest());
      buttons.appendChild(runTestButton);

      // Run all tests button
      const runAllButton = document.createElement('button');
      runAllButton.className = 'eval-button primary';
      runAllButton.textContent = i18nString(UIStrings.runAllTests);
      runAllButton.disabled = this.#state.isRunning;
      runAllButton.addEventListener('click', () => this.#runAllTests());
      buttons.appendChild(runAllButton);
    } else {
      // Agent test buttons
      const runBasicAgentButton = document.createElement('button');
      runBasicAgentButton.className = 'eval-button primary';
      runBasicAgentButton.textContent = i18nString(UIStrings.runBasicAgentTests);
      runBasicAgentButton.disabled = this.#state.isRunning;
      runBasicAgentButton.addEventListener('click', () => this.#runBasicAgentTests());
      buttons.appendChild(runBasicAgentButton);

      const runAllAgentButton = document.createElement('button');
      runAllAgentButton.className = 'eval-button primary';
      runAllAgentButton.textContent = i18nString(UIStrings.runAllAgentTests);
      runAllAgentButton.disabled = this.#state.isRunning;
      runAllAgentButton.addEventListener('click', () => this.#runAllAgentTests());
      buttons.appendChild(runAllAgentButton);
    }

    // Close button
    const closeButton = document.createElement('button');
    closeButton.className = 'eval-button';
    closeButton.textContent = i18nString(UIStrings.close);
    closeButton.addEventListener('click', () => this.#dialog.hide());
    buttons.appendChild(closeButton);

    return buttons;
  }

  #clearResults(): void {
    this.#state.testResults.clear();
    this.#state.completedTests = 0;
    this.#state.totalTests = 0;
    this.#state.testLogs = [];
    this.#render();
  }

  #addLog(message: string): void {
    const timestamp = new Date().toLocaleTimeString();
    this.#state.testLogs.push(`[${timestamp}] ${message}`);
    // Keep only last 1000 logs to prevent memory issues
    if (this.#state.testLogs.length > 1000) {
      this.#state.testLogs = this.#state.testLogs.slice(-1000);
    }
    // Re-render if logs panel is visible
    if (this.#state.bottomPanelView === 'logs') {
      this.#render();
    }
  }

  async #runSingleTest(): Promise<void> {
    if (!this.#evaluationRunner || this.#state.isRunning) {
      return;
    }

    const testId = 'github-repo-001'; // Simple test
    this.#state.isRunning = true;
    this.#state.currentRunningTest = testId;
    this.#state.totalTests = 1;
    this.#state.completedTests = 0;
    this.#state.startTime = Date.now();
    this.#render();

    try {
      const logMessage = `🧪 Running single evaluation test: ${testId}`;
      console.log(logMessage);
      this.#addLog(logMessage);
      const result = await this.#evaluationRunner.runSingleTest(testId);
      
      this.#state.testResults.set(testId, result);
      this.#state.completedTests = 1;
      const successLog = `✅ Test completed: ${testId} - ${result.status.toUpperCase()}`;
      console.log('✅ Test completed:', result);
      this.#addLog(successLog);
      
    } catch (error) {
      const errorLog = `❌ Test failed: ${testId} - ${error instanceof Error ? error.message : String(error)}`;
      console.error('❌ Test failed:', error);
      this.#addLog(errorLog);
      this.#state.testResults.set(testId, {
        testId,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        duration: 0,
        timestamp: Date.now(),
      });
      this.#state.completedTests = 1;
    } finally {
      this.#state.isRunning = false;
      this.#state.currentRunningTest = undefined;
      this.#render();
    }
  }

  async #runAllTests(): Promise<void> {
    if (!this.#evaluationRunner || this.#state.isRunning) {
      return;
    }

    this.#state.isRunning = true;
    this.#state.testResults.clear();
    this.#state.totalTests = schemaExtractorTests.length;
    this.#state.completedTests = 0;
    this.#state.startTime = Date.now();
    this.#render();

    try {
      const logMessage = `🧪 Running all evaluation tests (${schemaExtractorTests.length} tests)...`;
      console.log(logMessage);
      this.#addLog(logMessage);
      
      // Run tests sequentially with UI updates
      for (const testCase of schemaExtractorTests) {
        this.#state.currentRunningTest = testCase.id;
        this.#render();
        
        try {
          this.#addLog(`Running test: ${testCase.name}`);
          const result = await this.#evaluationRunner.runSingleTest(testCase.id);
          this.#state.testResults.set(testCase.id, result);
          this.#addLog(`Test ${testCase.id} completed: ${result.status.toUpperCase()}`);
        } catch (error) {
          this.#addLog(`ERROR in test ${testCase.id}: ${error instanceof Error ? error.message : String(error)}`);
          this.#state.testResults.set(testCase.id, {
            testId: testCase.id,
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
            duration: 0,
            timestamp: Date.now(),
          });
        }
        
        this.#state.completedTests++;
        this.#render();
        
        // Small delay between tests
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      const completionLog = '✅ All tests completed';
      console.log(completionLog);
      this.#addLog(completionLog);
      
    } catch (error) {
      console.error('❌ Test batch failed:', error);
    } finally {
      this.#state.isRunning = false;
      this.#state.currentRunningTest = undefined;
      this.#render();
    }
  }

  async #runBasicAgentTests(): Promise<void> {
    if (!this.#agentEvaluationRunner || this.#state.isRunning) {
      return;
    }

    const basicTests = this.#state.agentType === 'action' ? getBasicActionTests() : getBasicResearchTests();
    const agentName = this.#state.agentType === 'action' ? 'action_agent' : 'research_agent';
    
    this.#state.isRunning = true;
    this.#state.testResults.clear();
    this.#state.totalTests = basicTests.length;
    this.#state.completedTests = 0;
    this.#state.startTime = Date.now();
    this.#render();

    try {
      const logMessage = `🤖 Running basic ${this.#state.agentType} agent tests (${basicTests.length} tests)...`;
      console.log(logMessage);
      this.#addLog(logMessage);
      
      // Run tests sequentially with UI updates
      for (const testCase of basicTests) {
        this.#state.currentRunningTest = testCase.id;
        this.#render();
        
        try {
          this.#addLog(`Running ${agentName} test: ${testCase.name}`);
          const result = await this.#runAgentTest(testCase as any, agentName);
          this.#state.testResults.set(testCase.id, result);
          this.#addLog(`Test ${testCase.id} completed: ${result.status.toUpperCase()}`);
        } catch (error) {
          this.#addLog(`ERROR in test ${testCase.id}: ${error instanceof Error ? error.message : String(error)}`);
          this.#state.testResults.set(testCase.id, {
            testId: testCase.id,
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
            duration: 0,
            timestamp: Date.now(),
          });
        }
        
        this.#state.completedTests++;
        this.#render();
        
        // Longer delay between agent tests
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      const completionLog = '✅ Basic agent tests completed';
      console.log(completionLog);
      this.#addLog(completionLog);
      
    } catch (error) {
      console.error('❌ Agent test batch failed:', error);
    } finally {
      this.#state.isRunning = false;
      this.#state.currentRunningTest = undefined;
      this.#render();
    }
  }

  async #runAllAgentTests(): Promise<void> {
    if (!this.#agentEvaluationRunner || this.#state.isRunning) {
      return;
    }

    const allTests = this.#state.agentType === 'action' ? actionAgentTests : researchAgentTests;
    const agentName = this.#state.agentType === 'action' ? 'action_agent' : 'research_agent';

    this.#state.isRunning = true;
    this.#state.testResults.clear();
    this.#state.totalTests = allTests.length;
    this.#state.completedTests = 0;
    this.#state.startTime = Date.now();
    this.#render();

    try {
      const logMessage = `🤖 Running all ${this.#state.agentType} agent tests (${allTests.length} tests)...`;
      console.log(logMessage);
      this.#addLog(logMessage);
      
      // Run tests sequentially with UI updates
      for (const testCase of allTests) {
        this.#state.currentRunningTest = testCase.id;
        this.#render();
        
        try {
          this.#addLog(`Running ${agentName} test: ${testCase.name}`);
          const result = await this.#runAgentTest(testCase as any, agentName);
          this.#state.testResults.set(testCase.id, result);
          this.#addLog(`Test ${testCase.id} completed: ${result.status.toUpperCase()}`);
        } catch (error) {
          this.#addLog(`ERROR in test ${testCase.id}: ${error instanceof Error ? error.message : String(error)}`);
          this.#state.testResults.set(testCase.id, {
            testId: testCase.id,
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
            duration: 0,
            timestamp: Date.now(),
          });
        }
        
        this.#state.completedTests++;
        this.#render();
        
        // Longer delay between agent tests
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      const completionLog = '✅ All agent tests completed';
      console.log(completionLog);
      this.#addLog(completionLog);
      
    } catch (error) {
      console.error('❌ Agent test batch failed:', error);
    } finally {
      this.#state.isRunning = false;
      this.#state.currentRunningTest = undefined;
      this.#render();
    }
  }

  #viewDetailedReport(): void {
    if (this.#state.testResults.size === 0) {
      return;
    }

    const results = Array.from(this.#state.testResults.values());
    let testCases;
    let reportTitle;
    
    if (this.#state.activeTab === 'schema-extractor') {
      testCases = schemaExtractorTests;
      reportTitle = 'Schema Extractor Test Report';
    } else {
      // Agent tests
      testCases = this.#state.agentType === 'action' ? actionAgentTests : researchAgentTests;
      reportTitle = this.#state.agentType === 'action' ? 'Action Agent Test Report' : 'Research Agent Test Report';
    }

    // Generate detailed markdown report
    const markdownReport = MarkdownReportGenerator.generateDetailedReport(
      results,
      testCases,
      {
        title: reportTitle,
        includeConversationDetails: this.#state.activeTab === 'agents',
        includeFailureDetails: true,
        includePerformanceMetrics: true
      }
    );

    // Open in AI Assistant markdown viewer using the shared utility
    MarkdownViewerUtil.openInAIAssistantViewer(markdownReport);
  }

  /**
   * Run a single agent test using the unified runner
   */
  async #runSelectedTests(): Promise<void> {
    if (this.#state.isRunning || this.#state.selectedTests.size === 0) {
      return;
    }

    // Get the appropriate test cases and filter by selection
    let allTests;
    let selectedTests;
    let agentName = '';
    
    if (this.#state.activeTab === 'schema-extractor') {
      allTests = schemaExtractorTests;
      selectedTests = allTests.filter(test => this.#state.selectedTests.has(test.id));
    } else {
      allTests = this.#state.agentType === 'action' ? actionAgentTests : researchAgentTests;
      selectedTests = allTests.filter(test => this.#state.selectedTests.has(test.id));
      agentName = this.#state.agentType === 'action' ? 'action_agent' : 'research_agent';
    }

    this.#state.isRunning = true;
    this.#state.totalTests = selectedTests.length;
    this.#state.completedTests = 0;
    this.#state.startTime = Date.now();
    this.#render();

    try {
      const logMessage = `🎯 Running ${selectedTests.length} selected tests...`;
      console.log(logMessage);
      this.#addLog(logMessage);
      
      // Run selected tests sequentially
      for (const testCase of selectedTests) {
        this.#state.currentRunningTest = testCase.id;
        this.#render();
        
        try {
          this.#addLog(`Running test: ${testCase.name}`);
          let result;
          if (this.#state.activeTab === 'schema-extractor' && this.#evaluationRunner) {
            result = await this.#evaluationRunner.runSingleTest(testCase.id);
          } else if (this.#agentEvaluationRunner) {
            result = await this.#runAgentTest(testCase as any, agentName);
          } else {
            throw new Error('No runner available');
          }
          
          this.#state.testResults.set(testCase.id, result);
          this.#addLog(`Test ${testCase.id} completed: ${result.status.toUpperCase()}`);
        } catch (error) {
          this.#addLog(`ERROR in test ${testCase.id}: ${error instanceof Error ? error.message : String(error)}`);
          this.#state.testResults.set(testCase.id, {
            testId: testCase.id,
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
            duration: 0,
            timestamp: Date.now(),
          });
        }
        
        this.#state.completedTests++;
        this.#render();
        
        // Delay between tests (longer for agent tests)
        const delay = this.#state.activeTab === 'agents' ? 3000 : 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      const completionLog = '✅ Selected tests completed';
      console.log(completionLog);
      this.#addLog(completionLog);
      
      // Clear selection after running
      this.#state.selectedTests.clear();
      
    } catch (error) {
      console.error('❌ Selected test batch failed:', error);
    } finally {
      this.#state.isRunning = false;
      this.#state.currentRunningTest = undefined;
      this.#render();
    }
  }

  async #runAgentTest(testCase: any, agentName: string): Promise<TestResult> {
    if (!this.#agentEvaluationRunner) {
      throw new Error('Agent evaluation runner not initialized');
    }
    return await this.#agentEvaluationRunner.runSingleTest(testCase, agentName);
  }
}