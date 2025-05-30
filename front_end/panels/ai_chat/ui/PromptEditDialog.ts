// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as i18n from '../../../core/i18n/i18n.js';
import * as UI from '../../../ui/legacy/legacy.js';

interface PromptEditDialogOptions {
  agentType: string;
  agentLabel: string;
  currentPrompt: string;
  defaultPrompt: string;
  hasCustomPrompt: boolean;
  onSave: (prompt: string) => void;
  onRestore: () => void;
}

const UIStrings = {
  /**
   *@description Dialog title for editing agent prompts
   */
  title: 'Edit Agent Prompt',
  /**
   *@description Label for the agent type being edited
   */
  agentTypeLabel: 'Agent Type',
  /**
   *@description Label for the prompt textarea
   */
  promptLabel: 'System Prompt',
  /**
   *@description Hint text for the prompt textarea
   */
  promptHint: 'Enter the system prompt that defines how this agent behaves',
  /**
   *@description Save button text
   */
  saveButton: 'Save Custom Prompt',
  /**
   *@description Restore default button text
   */
  restoreButton: 'Restore Default',
  /**
   *@description Cancel button text
   */
  cancelButton: 'Cancel',
  /**
   *@description Status message when prompt is saved
   */
  promptSaved: 'Custom prompt saved successfully',
  /**
   *@description Status message when prompt is restored to default
   */
  promptRestored: 'Prompt restored to default',
  /**
   *@description Custom prompt indicator
   */
  customPromptIndicator: 'Using custom prompt',
  /**
   *@description Default prompt indicator
   */
  defaultPromptIndicator: 'Using default prompt',
} as const;

const str_ = i18n.i18n.registerUIStrings('panels/ai_chat/ui/PromptEditDialog.ts', UIStrings);
const i18nString = i18n.i18n.getLocalizedString.bind(undefined, str_);

export class PromptEditDialog {
  static show(options: PromptEditDialogOptions): void {
    const dialog = new UI.Dialog.Dialog();
    dialog.setDimmed(true);
    dialog.setOutsideClickCallback(() => dialog.hide());
    dialog.contentElement.classList.add('prompt-edit-dialog');

    // Create main content container
    const contentDiv = document.createElement('div');
    contentDiv.className = 'prompt-edit-content';
    dialog.contentElement.appendChild(contentDiv);

    // Create header
    const headerDiv = document.createElement('div');
    headerDiv.className = 'prompt-edit-header';
    contentDiv.appendChild(headerDiv);

    const title = document.createElement('h2');
    title.className = 'prompt-edit-title';
    title.textContent = i18nString(UIStrings.title);
    headerDiv.appendChild(title);

    const closeButton = document.createElement('button');
    closeButton.className = 'prompt-edit-close-button';
    closeButton.setAttribute('aria-label', 'Close dialog');
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => dialog.hide());
    headerDiv.appendChild(closeButton);

    // Agent type display
    const agentSection = document.createElement('div');
    agentSection.className = 'prompt-edit-section';
    contentDiv.appendChild(agentSection);

    const agentLabel = document.createElement('div');
    agentLabel.className = 'prompt-edit-label';
    agentLabel.textContent = i18nString(UIStrings.agentTypeLabel);
    agentSection.appendChild(agentLabel);

    const agentValue = document.createElement('div');
    agentValue.className = 'prompt-edit-agent-value';
    agentValue.textContent = options.agentLabel;
    agentSection.appendChild(agentValue);

    // Status indicator
    const statusIndicator = document.createElement('div');
    statusIndicator.className = `prompt-edit-status ${options.hasCustomPrompt ? 'custom' : 'default'}`;
    statusIndicator.textContent = options.hasCustomPrompt ? 
      i18nString(UIStrings.customPromptIndicator) : 
      i18nString(UIStrings.defaultPromptIndicator);
    agentSection.appendChild(statusIndicator);

    // Prompt editing section
    const promptSection = document.createElement('div');
    promptSection.className = 'prompt-edit-section';
    contentDiv.appendChild(promptSection);

    const promptLabel = document.createElement('div');
    promptLabel.className = 'prompt-edit-label';
    promptLabel.textContent = i18nString(UIStrings.promptLabel);
    promptSection.appendChild(promptLabel);

    const promptHint = document.createElement('div');
    promptHint.className = 'prompt-edit-hint';
    promptHint.textContent = i18nString(UIStrings.promptHint);
    promptSection.appendChild(promptHint);

    const promptTextarea = document.createElement('textarea');
    promptTextarea.className = 'prompt-edit-textarea';
    promptTextarea.value = options.currentPrompt;
    promptTextarea.rows = 20;
    promptTextarea.cols = 80;
    promptSection.appendChild(promptTextarea);

    // Status message
    const statusMessage = document.createElement('div');
    statusMessage.className = 'prompt-edit-status-message';
    statusMessage.style.display = 'none';
    contentDiv.appendChild(statusMessage);

    // Button container
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'prompt-edit-buttons';
    contentDiv.appendChild(buttonContainer);

    // Restore button (only show if has custom prompt)
    let restoreButton: HTMLButtonElement | null = null;
    if (options.hasCustomPrompt) {
      restoreButton = document.createElement('button');
      restoreButton.className = 'prompt-edit-button restore-button';
      restoreButton.textContent = i18nString(UIStrings.restoreButton);
      restoreButton.addEventListener('click', () => {
        promptTextarea.value = options.defaultPrompt;
        statusIndicator.className = 'prompt-edit-status default';
        statusIndicator.textContent = i18nString(UIStrings.defaultPromptIndicator);
        
        options.onRestore();
        
        statusMessage.textContent = i18nString(UIStrings.promptRestored);
        statusMessage.style.backgroundColor = 'var(--color-accent-green-background)';
        statusMessage.style.color = 'var(--color-accent-green)';
        statusMessage.style.display = 'block';
        
        // Hide restore button after restoring
        if (restoreButton) {
          restoreButton.style.display = 'none';
        }
        
        setTimeout(() => {
          statusMessage.style.display = 'none';
        }, 3000);
      });
      buttonContainer.appendChild(restoreButton);
    }

    // Cancel button
    const cancelButton = document.createElement('button');
    cancelButton.className = 'prompt-edit-button cancel-button';
    cancelButton.textContent = i18nString(UIStrings.cancelButton);
    cancelButton.addEventListener('click', () => dialog.hide());
    buttonContainer.appendChild(cancelButton);

    // Save button
    const saveButton = document.createElement('button');
    saveButton.className = 'prompt-edit-button save-button';
    saveButton.textContent = i18nString(UIStrings.saveButton);
    saveButton.addEventListener('click', () => {
      const newPrompt = promptTextarea.value.trim();
      if (newPrompt) {
        options.onSave(newPrompt);
        
        statusIndicator.className = 'prompt-edit-status custom';
        statusIndicator.textContent = i18nString(UIStrings.customPromptIndicator);
        
        statusMessage.textContent = i18nString(UIStrings.promptSaved);
        statusMessage.style.backgroundColor = 'var(--color-accent-green-background)';
        statusMessage.style.color = 'var(--color-accent-green)';
        statusMessage.style.display = 'block';
        
        // Show restore button after saving custom prompt
        if (!restoreButton) {
          const newRestoreButton = document.createElement('button');
          newRestoreButton.className = 'prompt-edit-button restore-button';
          newRestoreButton.textContent = i18nString(UIStrings.restoreButton);
          newRestoreButton.addEventListener('click', () => {
            promptTextarea.value = options.defaultPrompt;
            statusIndicator.className = 'prompt-edit-status default';
            statusIndicator.textContent = i18nString(UIStrings.defaultPromptIndicator);
            
            options.onRestore();
            
            statusMessage.textContent = i18nString(UIStrings.promptRestored);
            statusMessage.style.backgroundColor = 'var(--color-accent-green-background)';
            statusMessage.style.color = 'var(--color-accent-green)';
            statusMessage.style.display = 'block';
            
            newRestoreButton.style.display = 'none';
            
            setTimeout(() => {
              statusMessage.style.display = 'none';
            }, 3000);
          });
          buttonContainer.insertBefore(newRestoreButton, cancelButton);
          restoreButton = newRestoreButton;
        } else {
          restoreButton.style.display = 'inline-block';
        }
        
        setTimeout(() => {
          statusMessage.style.display = 'none';
        }, 3000);
      }
    });
    buttonContainer.appendChild(saveButton);

    // Add styles
    const styleElement = document.createElement('style');
    styleElement.textContent = `
      .prompt-edit-dialog {
        color: var(--color-text-primary);
        background-color: var(--color-background);
        max-width: 90vw;
        max-height: 90vh;
      }
      
      .prompt-edit-content {
        padding: 0;
        display: flex;
        flex-direction: column;
        height: 100%;
        min-width: 600px;
        min-height: 500px;
      }
      
      .prompt-edit-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid var(--color-details-hairline);
        flex-shrink: 0;
      }
      
      .prompt-edit-title {
        font-size: 18px;
        font-weight: 500;
        margin: 0;
        color: var(--color-text-primary);
      }
      
      .prompt-edit-close-button {
        background: none;
        border: none;
        font-size: 20px;
        cursor: pointer;
        color: var(--color-text-secondary);
        padding: 4px 8px;
      }
      
      .prompt-edit-close-button:hover {
        color: var(--color-text-primary);
      }
      
      .prompt-edit-section {
        padding: 16px 20px;
        border-bottom: 1px solid var(--color-details-hairline);
      }
      
      .prompt-edit-label {
        font-size: 14px;
        font-weight: 500;
        margin-bottom: 6px;
        color: var(--color-text-primary);
      }
      
      .prompt-edit-hint {
        font-size: 12px;
        color: var(--color-text-secondary);
        margin-bottom: 8px;
      }
      
      .prompt-edit-agent-value {
        font-size: 16px;
        font-weight: 500;
        color: var(--color-text-primary);
        margin-bottom: 8px;
      }
      
      .prompt-edit-status {
        font-size: 12px;
        padding: 4px 8px;
        border-radius: 4px;
        display: inline-block;
      }
      
      .prompt-edit-status.custom {
        background-color: var(--color-accent-blue-background);
        color: var(--color-accent-blue);
      }
      
      .prompt-edit-status.default {
        background-color: var(--color-background-elevation-2);
        color: var(--color-text-secondary);
      }
      
      .prompt-edit-textarea {
        width: 100%;
        padding: 12px;
        border: 1px solid var(--color-details-hairline);
        border-radius: 4px;
        background-color: var(--color-background-elevation-2);
        color: var(--color-text-primary);
        font-family: 'Menlo', 'Monaco', 'Consolas', monospace;
        font-size: 13px;
        line-height: 1.4;
        resize: vertical;
        box-sizing: border-box;
      }
      
      .prompt-edit-textarea:focus {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: 0 0 0 1px var(--color-primary-opacity-30);
      }
      
      .prompt-edit-status-message {
        padding: 8px 16px;
        margin: 8px 20px;
        border-radius: 4px;
        font-size: 13px;
      }
      
      .prompt-edit-buttons {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 16px 20px;
        border-top: 1px solid var(--color-details-hairline);
        flex-shrink: 0;
      }
      
      .prompt-edit-button {
        padding: 8px 16px;
        border-radius: 4px;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.2s;
        font-family: inherit;
        border: 1px solid var(--color-details-hairline);
      }
      
      .cancel-button, .restore-button {
        background-color: var(--color-background-elevation-1);
        color: var(--color-text-primary);
      }
      
      .cancel-button:hover, .restore-button:hover {
        background-color: var(--color-background-elevation-2);
      }
      
      .save-button {
        background-color: var(--color-primary);
        border-color: var(--color-primary);
        color: white;
      }
      
      .save-button:hover {
        background-color: var(--color-primary-variant);
        border-color: var(--color-primary-variant);
      }
      
      .restore-button {
        background-color: var(--color-accent-orange-background);
        border-color: var(--color-accent-orange);
        color: var(--color-accent-orange);
      }
      
      .restore-button:hover {
        background-color: var(--color-accent-orange);
        color: white;
      }
    `;
    dialog.contentElement.appendChild(styleElement);

    dialog.show();
    promptTextarea.focus();
  }
}