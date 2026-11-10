// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Get CSS styles for settings dialog
 */
export function getSettingsStyles(): string {
  return `
    .settings-dialog {
      color: var(--color-text-primary);
      background-color: var(--color-background);
    }

    .settings-content {
      padding: 0;
      max-width: 100%;
    }

    .settings-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid var(--color-details-hairline);
    }

    .settings-title {
      font-size: 18px;
      font-weight: 500;
      margin: 0;
      color: var(--color-text-primary);
    }

    .settings-close-button {
      background: none;
      border: none;
      font-size: 20px;
      cursor: pointer;
      color: var(--color-text-secondary);
      padding: 4px 8px;
    }

    .settings-close-button:hover {
      color: var(--color-text-primary);
    }

    .provider-selection-section {
      padding: 16px 20px;
      border-bottom: 1px solid var(--color-details-hairline);
    }

    .provider-select {
      margin-top: 8px;
    }

    .provider-content {
      padding: 16px 20px;
      border-bottom: 1px solid var(--color-details-hairline);
    }

    .settings-section {
      margin-bottom: 24px;
    }

    .settings-subtitle {
      font-size: 16px;
      font-weight: 500;
      margin: 0 0 12px 0;
      color: var(--color-text-primary);
    }

    .settings-label {
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 6px;
      color: var(--color-text-primary);
    }

    .settings-hint {
      font-size: 12px;
      color: var(--color-text-secondary);
      margin-bottom: 8px;
    }

    .settings-description {
      font-size: 14px;
      color: var(--color-text-secondary);
      margin: 4px 0 12px 0;
    }

    .settings-input, .settings-select {
      width: 100%;
      padding: 8px 12px;
      border-radius: 4px;
      border: 1px solid var(--color-details-hairline);
      background-color: var(--color-background-elevation-2);
      color: var(--color-text-primary);
      font-size: 14px;
      box-sizing: border-box;
      height: 32px;
    }

    .settings-input:focus, .settings-select:focus {
      outline: none;
      border-color: var(--color-primary);
      box-shadow: 0 0 0 1px var(--color-primary-opacity-30);
    }

    .settings-status {
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 13px;
      margin: 8px 0;
    }

    .fetch-button-container {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 12px 0;
    }

    .custom-models-section {
      margin-top: 16px;
    }

    .custom-models-list {
      margin-bottom: 16px;
    }

    .custom-model-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      padding: 6px 0;
      border-bottom: 1px solid var(--color-details-hairline);
    }

    .custom-model-name {
      flex: 1;
      font-size: 14px;
    }

    .new-model-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .custom-model-input {
      flex: 1;
      margin-bottom: 0;
    }

    /* Button spacing and layout */
    .button-group {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .test-status {
      font-size: 12px;
      margin-left: 4px;
    }

    .model-test-status {
      margin-top: 4px;
    }

    .model-selection-container {
      margin-bottom: 20px;
    }

    /* Model selector component styles (shared with chat view) */
    .model-selection-container ai-model-selector { display: block; width: 100%; }
    .model-selector.searchable { position: relative; }
    .model-select-trigger {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      border: 1px solid var(--color-details-hairline);
      border-radius: 6px;
      background: var(--color-background-elevation-1);
      cursor: pointer;
      width: 100%;
      font-size: 12px;
      color: var(--color-text-primary);
      transition: all 0.2s ease;
      box-sizing: border-box;
    }
    .model-select-trigger:hover:not(:disabled) { background: var(--color-background-elevation-2); border-color: #00a4fe; }
    .model-select-trigger:disabled { opacity: 0.6; cursor: not-allowed; background-color: var(--color-background-elevation-0); }
    .selected-model { flex: 1; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .dropdown-arrow { margin-left: 8px; font-size: 10px; color: var(--color-text-secondary); transition: transform 0.2s ease; }
    .model-dropdown { position: absolute; left: 0; right: 0; background: var(--color-background-elevation-1); border: 1px solid var(--color-details-hairline); border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 1000; max-height: 300px; overflow: hidden; }
    .model-dropdown.below { top: 100%; margin-top: 2px; }
    .model-dropdown.above { bottom: 100%; margin-bottom: 2px; }
    .model-search { width: 100%; padding: 8px 12px; border: none; border-bottom: 1px solid var(--color-details-hairline); outline: none; background: var(--color-background-elevation-1); color: var(--color-text-primary); font-size: 12px; box-sizing: border-box; }
    .model-search::placeholder { color: var(--color-text-secondary); }
    .model-options { max-height: 240px; overflow-y: auto; }
    .model-option { padding: 8px 12px; cursor: pointer; border-bottom: 1px solid var(--color-details-hairline); font-size: 12px; color: var(--color-text-primary); transition: background-color 0.2s ease; }
    .model-option:last-child { border-bottom: none; }
    .model-option:hover, .model-option.highlighted { background: #def1fb; }
    .model-option.selected { background: #00a4fe; color: white; }
    .model-option.no-results { color: var(--color-text-secondary); cursor: default; font-style: italic; }
    .model-option.no-results:hover { background: transparent; }

    .mini-model-description, .nano-model-description {
      font-size: 12px;
      font-style: italic;
    }

    .memory-section {
      margin-top: 16px;
      padding: 16px 20px;
      border-bottom: 1px solid var(--color-details-hairline);
    }

    .history-section {
      margin-top: 16px;
      padding: 16px 20px;
      border-bottom: 1px solid var(--color-details-hairline);
    }

    .disclaimer-section {
      background-color: var(--color-background-elevation-1);
      border-radius: 8px;
      padding: 16px 20px;
      margin: 16px 20px;
      border: 1px solid var(--color-details-hairline);
    }

    .disclaimer-warning {
      color: var(--color-accent-orange);
      margin-bottom: 8px;
    }

    .disclaimer-note {
      margin-bottom: 8px;
    }

    .disclaimer-footer {
      font-size: 12px;
      color: var(--color-text-secondary);
      margin-top: 8px;
    }

    .settings-footer {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      border-top: 1px solid var(--color-details-hairline);
    }

    .save-status {
      margin: 0;
      font-size: 13px;
      padding: 6px 10px;
    }

    .settings-button {
      padding: 8px 16px;
      border-radius: 4px;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
      background-color: var(--color-background-elevation-1);
      border: 1px solid var(--color-details-hairline);
      color: var(--color-text-primary);
    }

    .settings-button:hover {
      background-color: var(--color-background-elevation-2);
    }

    .settings-button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Add button styling */
    .add-button {
      min-width: 60px;
      border-radius: 4px;
      font-size: 12px;
      background-color: var(--color-background-elevation-1);
    }

    .add-button:hover {
      background-color: var(--color-background-elevation-2);
    }

    /* Icon button styling */
    .icon-button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: none;
      background: transparent;
      cursor: pointer;
      padding: 0;
      color: var(--color-text-secondary);
      transition: all 0.15s;
    }

    .icon-button:hover {
      background-color: var(--color-background-elevation-2);
    }

    /* Specific icon button hover states */
    .remove-button:hover {
      color: var(--color-accent-red);
    }

    .test-button:hover {
      color: var(--color-accent-green);
    }

    .trash-icon, .check-icon {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* Cancel button */
    .cancel-button {
      background-color: var(--color-background-elevation-1);
      border: 1px solid var(--color-details-hairline);
      color: var(--color-text-primary);
    }

    .cancel-button:hover {
      background-color: var(--color-background-elevation-2);
    }

    /* Save button */
    .save-button {
      background-color: var(--color-primary);
      border: 1px solid var(--color-primary);
      color: white;
    }

    .save-button:hover {
      background-color: var(--color-primary-variant);
    }

    .clear-button {
      margin-top: 8px;
    }

    /* Vector DB section styles */
    .vector-db-section {
      margin-top: 16px;
      padding: 16px 20px;
      border-bottom: 1px solid var(--color-details-hairline);
    }

    /* Tracing section styles */
    .tracing-section {
      margin-top: 16px;
      padding: 16px 20px;
      border-bottom: 1px solid var(--color-details-hairline);
    }

    .panel-filter-section {
      margin-top: 16px;
      padding: 16px 20px;
      border-bottom: 1px solid var(--color-details-hairline);
    }

    .settings-section-title {
      font-size: 16px;
      font-weight: 500;
      color: var(--color-text-primary);
      margin: 0 0 16px 0;
    }

    .tracing-enabled-container {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .tracing-checkbox {
      margin: 0;
    }

    .tracing-label {
      font-weight: 500;
      color: var(--color-text-primary);
      cursor: pointer;
    }

    .tracing-config-container {
      margin-top: 16px;
      padding-left: 24px;
      border-left: 2px solid var(--color-details-hairline);
    }

    /* Apply tracing config visual style to Evaluation section */
    .evaluation-enabled-container {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .evaluation-checkbox { margin: 0; }
    .evaluation-label {
      font-weight: 500;
      color: var(--color-text-primary);
      cursor: pointer;
    }
    .evaluation-config-container {
      margin-top: 16px;
      padding-left: 24px;
      border-left: 2px solid var(--color-details-hairline);
    }

    /* Apply tracing config visual style to MCP section */
    .mcp-enabled-container {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .mcp-checkbox { margin: 0; }
    .mcp-label {
      font-weight: 500;
      color: var(--color-text-primary);
      cursor: pointer;
    }
    .mcp-config-container {
      margin-top: 16px;
      padding-left: 24px;
      border-left: 2px solid var(--color-details-hairline);
    }

    /* Advanced Settings Toggle styles */
    .advanced-settings-toggle-section {
      padding: 16px 20px;
      border-bottom: 1px solid var(--color-details-hairline);
      background-color: var(--color-background-highlight);
    }

    .advanced-settings-toggle-container {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      padding-left: 20px;
    }

    .advanced-settings-checkbox {
      margin: 0;
      transform: scale(1.1);
    }

    .advanced-settings-label {
      font-weight: 500;
      color: var(--color-text-primary);
      cursor: pointer;
      font-size: 14px;
    }

    /* Evaluation section styles */
    .evaluation-section {
      margin-top: 16px;
      padding: 16px 20px;
      border-bottom: 1px solid var(--color-details-hairline);
    }

    .evaluation-buttons-container {
      display: flex;
      gap: 8px;
      margin-top: 16px;
    }

    .connect-button {
      background-color: var(--color-accent-blue-background);
      color: var(--color-accent-blue);
      border: 1px solid var(--color-accent-blue);
    }

    .connect-button:hover {
      background-color: var(--color-accent-blue);
      color: var(--color-background);
    }

    .connect-button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .mcp-section {
      margin-top: 16px;
      padding: 16px 20px;
      border-bottom: 1px solid var(--color-details-hairline);
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    /* Memory blocks styles */
    .memory-blocks-container {
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid var(--color-details-hairline);
    }

    .memory-blocks-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--color-text-secondary);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .memory-blocks-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .memory-block-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 6px;
      background-color: var(--color-background-elevation-1);
      cursor: pointer;
      transition: background-color 0.15s ease;
    }

    .memory-block-delete {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px 8px;
      font-size: 16px;
      opacity: 0.4;
      transition: opacity 0.15s ease;
      flex-shrink: 0;
      border-radius: 4px;
    }

    .memory-block-delete:hover {
      opacity: 1;
      background-color: var(--color-background-elevation-2);
    }

    .memory-block-item:hover {
      background-color: var(--color-background-elevation-2);
    }

    .memory-block-item:focus {
      outline: 2px solid var(--color-primary);
      outline-offset: -2px;
    }

    .memory-block-icon {
      font-size: 18px;
      line-height: 1;
      flex-shrink: 0;
    }

    .memory-block-info {
      flex: 1;
      min-width: 0;
    }

    .memory-block-label {
      font-size: 14px;
      font-weight: 500;
      color: var(--color-text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .memory-block-meta {
      font-size: 12px;
      color: var(--color-text-secondary);
      margin-top: 2px;
    }

    .memory-blocks-empty {
      font-size: 13px;
      color: var(--color-text-secondary);
      font-style: italic;
      padding: 8px 0;
    }

    .memory-blocks-error {
      font-size: 13px;
      color: var(--color-accent-red);
      padding: 8px 0;
    }

    .memory-status-message {
      font-size: 13px;
      padding: 8px 12px;
      border-radius: 4px;
      margin: 8px 0;
    }

    .memory-status-message.error {
      background-color: var(--color-accent-red-background, rgba(255, 0, 0, 0.1));
      color: var(--color-accent-red);
    }

    .memory-status-message.success {
      background-color: var(--color-accent-green-background, rgba(0, 255, 0, 0.1));
      color: var(--color-accent-green);
    }

    .memory-block-delete-container {
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }

    .memory-block-confirm {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .memory-block-confirm-label {
      font-size: 12px;
      color: var(--color-text-secondary);
    }

    .memory-block-confirm-yes,
    .memory-block-confirm-no {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      border: 1px solid var(--color-details-hairline);
      background: var(--color-background);
    }

    .memory-block-confirm-yes {
      color: var(--color-accent-red);
      border-color: var(--color-accent-red);
    }

    .memory-block-confirm-yes:hover {
      background-color: var(--color-accent-red);
      color: white;
    }

    .memory-block-confirm-no:hover {
      background-color: var(--color-background-elevation-2);
    }
  `;
}

/**
 * Apply settings dialog styles to a dialog element
 */
export function applySettingsStyles(dialogElement: HTMLElement): void {
  const styleElement = document.createElement('style');
  styleElement.textContent = getSettingsStyles();
  dialogElement.appendChild(styleElement);
}
