// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { i18nString, UIStrings } from '../i18n-strings.js';
import { MEMORY_ENABLED_KEY } from '../constants.js';
import { MemoryBlockManager } from '../../../memory/MemoryBlockManager.js';
import { FileContentViewer } from '../../FileContentViewer.js';
import type { MemoryBlock } from '../../../memory/types.js';
import type { FileSummary } from '../../../tools/FileStorageManager.js';

/**
 * Memory System Settings
 *
 * Allows enabling/disabling the memory system that extracts and stores
 * facts from conversations for use in future sessions.
 * Also displays stored memory blocks with the ability to view their contents.
 */
export class MemorySettings {
  private container: HTMLElement;
  private memoryEnabledCheckbox: HTMLInputElement | null = null;
  private blockListContainer: HTMLElement | null = null;
  private blockManager: MemoryBlockManager;
  private statusMessageElement: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.blockManager = new MemoryBlockManager();
  }

  render(): void {
    // Clear any existing content
    this.container.innerHTML = '';
    this.container.className = 'settings-section memory-section';

    // Title
    const memoryTitle = document.createElement('h3');
    memoryTitle.textContent = i18nString(UIStrings.memoryLabel);
    memoryTitle.classList.add('settings-subtitle');
    this.container.appendChild(memoryTitle);

    // Memory enabled checkbox
    const memoryEnabledContainer = document.createElement('div');
    memoryEnabledContainer.className = 'tracing-enabled-container';
    this.container.appendChild(memoryEnabledContainer);

    this.memoryEnabledCheckbox = document.createElement('input');
    this.memoryEnabledCheckbox.type = 'checkbox';
    this.memoryEnabledCheckbox.id = 'memory-enabled';
    this.memoryEnabledCheckbox.className = 'tracing-checkbox';
    // Default to enabled (true) if not set
    const storedValue = localStorage.getItem(MEMORY_ENABLED_KEY);
    this.memoryEnabledCheckbox.checked = storedValue !== 'false';
    memoryEnabledContainer.appendChild(this.memoryEnabledCheckbox);

    const memoryEnabledLabel = document.createElement('label');
    memoryEnabledLabel.htmlFor = 'memory-enabled';
    memoryEnabledLabel.className = 'tracing-label';
    memoryEnabledLabel.textContent = i18nString(UIStrings.memoryEnabled);
    memoryEnabledContainer.appendChild(memoryEnabledLabel);

    const memoryEnabledHint = document.createElement('div');
    memoryEnabledHint.className = 'settings-hint';
    memoryEnabledHint.textContent = i18nString(UIStrings.memoryEnabledHint);
    this.container.appendChild(memoryEnabledHint);

    // Toggle memory and save to localStorage
    this.memoryEnabledCheckbox.addEventListener('change', () => {
      localStorage.setItem(MEMORY_ENABLED_KEY, this.memoryEnabledCheckbox!.checked.toString());
      this.updateBlockListVisibility();
    });

    // Memory blocks list container
    this.blockListContainer = document.createElement('div');
    this.blockListContainer.className = 'memory-blocks-container';
    this.container.appendChild(this.blockListContainer);

    // Initial render of block list
    this.updateBlockListVisibility();
    this.renderMemoryBlocks();
  }

  /**
   * Update visibility of block list based on memory enabled state
   */
  private updateBlockListVisibility(): void {
    if (this.blockListContainer && this.memoryEnabledCheckbox) {
      this.blockListContainer.style.display = this.memoryEnabledCheckbox.checked ? 'block' : 'none';
    }
  }

  /**
   * Render the list of memory blocks
   */
  private async renderMemoryBlocks(): Promise<void> {
    if (!this.blockListContainer) {
      return;
    }

    this.blockListContainer.innerHTML = '';

    // Add a subtitle for the blocks section
    const blocksTitle = document.createElement('div');
    blocksTitle.className = 'memory-blocks-title';
    blocksTitle.textContent = 'Stored Memory';
    this.blockListContainer.appendChild(blocksTitle);

    // Create status message element
    this.statusMessageElement = document.createElement('div');
    this.statusMessageElement.className = 'memory-status-message';
    this.statusMessageElement.style.display = 'none';
    this.blockListContainer.appendChild(this.statusMessageElement);

    try {
      const blocks = await this.blockManager.getAllBlocks();

      if (blocks.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'memory-blocks-empty';
        emptyMessage.textContent = 'No memory blocks stored yet. Memory will be extracted from conversations automatically.';
        this.blockListContainer.appendChild(emptyMessage);
        return;
      }

      // Create block list
      const blockList = document.createElement('div');
      blockList.className = 'memory-blocks-list';

      for (const block of blocks) {
        const blockItem = this.createBlockItem(block);
        blockList.appendChild(blockItem);
      }

      this.blockListContainer.appendChild(blockList);
    } catch (error) {
      const errorMessage = document.createElement('div');
      errorMessage.className = 'memory-blocks-error';
      errorMessage.textContent = 'Failed to load memory blocks.';
      this.blockListContainer.appendChild(errorMessage);
    }
  }

  /**
   * Create a clickable block item
   */
  private createBlockItem(block: MemoryBlock): HTMLElement {
    const item = document.createElement('div');
    item.className = 'memory-block-item';
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');

    // Icon based on block type
    const icon = document.createElement('span');
    icon.className = 'memory-block-icon';
    icon.textContent = this.getBlockIcon(block.type);
    item.appendChild(icon);

    // Block info
    const info = document.createElement('div');
    info.className = 'memory-block-info';

    const label = document.createElement('div');
    label.className = 'memory-block-label';
    label.textContent = block.label;
    info.appendChild(label);

    const meta = document.createElement('div');
    meta.className = 'memory-block-meta';
    meta.textContent = this.formatBlockMeta(block);
    info.appendChild(meta);

    item.appendChild(info);

    // Delete button container (for inline confirmation)
    const deleteContainer = document.createElement('div');
    deleteContainer.className = 'memory-block-delete-container';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'memory-block-delete';
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = 'Delete this memory block';
    deleteBtn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation(); // Don't trigger view
      this.showInlineDeleteConfirmation(deleteContainer, deleteBtn, block);
    });
    deleteContainer.appendChild(deleteBtn);
    item.appendChild(deleteContainer);

    // Click handler to view content
    const handleClick = (): void => {
      this.viewBlock(block);
    };

    item.addEventListener('click', handleClick);
    item.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    });

    return item;
  }

  /**
   * Show inline delete confirmation UI
   */
  private showInlineDeleteConfirmation(
    container: HTMLElement,
    deleteBtn: HTMLElement,
    block: MemoryBlock
  ): void {
    // Hide the delete button
    deleteBtn.style.display = 'none';

    // Create confirmation UI
    const confirmUI = document.createElement('div');
    confirmUI.className = 'memory-block-confirm';

    const confirmLabel = document.createElement('span');
    confirmLabel.className = 'memory-block-confirm-label';
    confirmLabel.textContent = 'Delete?';
    confirmUI.appendChild(confirmLabel);

    const yesBtn = document.createElement('button');
    yesBtn.className = 'memory-block-confirm-yes';
    yesBtn.textContent = 'Yes';
    yesBtn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      void this.deleteBlock(block);
    });
    confirmUI.appendChild(yesBtn);

    const noBtn = document.createElement('button');
    noBtn.className = 'memory-block-confirm-no';
    noBtn.textContent = 'No';
    noBtn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      // Restore original delete button
      confirmUI.remove();
      deleteBtn.style.display = '';
    });
    confirmUI.appendChild(noBtn);

    container.appendChild(confirmUI);
  }

  /**
   * Delete a memory block
   */
  private async deleteBlock(block: MemoryBlock): Promise<void> {
    // Extract projectName from filename for project blocks
    let projectName: string | undefined;
    if (block.type === 'project') {
      projectName = block.filename.replace('memory_project_', '').replace('.md', '');
    }

    try {
      await this.blockManager.deleteBlock(block.type, projectName);
      await this.renderMemoryBlocks(); // Refresh list
    } catch (error) {
      console.error('Failed to delete memory block:', error);
      this.showStatusMessage('Failed to delete memory block.', 'error');
    }
  }

  /**
   * Get icon for block type
   */
  private getBlockIcon(type: string): string {
    switch (type) {
      case 'user':
        return '👤';
      case 'facts':
        return '💡';
      case 'project':
        return '📁';
      default:
        return '📄';
    }
  }

  /**
   * Format block metadata string
   */
  private formatBlockMeta(block: MemoryBlock): string {
    const charCount = this.formatCharCount(block.content.length);
    const updated = this.formatDate(block.updatedAt);
    return `${charCount} • Updated ${updated}`;
  }

  /**
   * Format character count
   */
  private formatCharCount(chars: number): string {
    if (chars < 1000) {
      return `${chars} chars`;
    }
    return `${(chars / 1000).toFixed(1)}K chars`;
  }

  /**
   * Format date for display
   */
  private formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'today';
    } else if (diffDays === 1) {
      return 'yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  }

  /**
   * Open FileContentViewer to display block content with edit capability
   */
  private async viewBlock(block: MemoryBlock): Promise<void> {
    // Create a FileSummary-compatible object for FileContentViewer
    const fileSummary: FileSummary = {
      fileName: block.filename,
      size: block.content.length,
      mimeType: 'text/markdown',
      createdAt: block.updatedAt,
      updatedAt: block.updatedAt,
    };

    const result = await FileContentViewer.show(fileSummary, block.content, {
      editable: true,
    });

    // If we got a webappId, start polling for saved content
    if (result?.webappId) {
      this.startPollingForSave(result.webappId, block);
    }
  }

  /** Active polling interval ID for save detection */
  private pollIntervalId: ReturnType<typeof setInterval> | null = null;

  /**
   * Start polling for saved content from the file viewer iframe
   */
  private startPollingForSave(webappId: string, block: MemoryBlock): void {
    // Clear any existing polling
    this.stopPollingForSave();

    // Poll every 500ms for saved content
    this.pollIntervalId = setInterval(async () => {
      const savedContent = await FileContentViewer.checkForSavedContent(webappId);
      if (savedContent !== null) {
        this.stopPollingForSave();
        await this.saveBlock(block, savedContent);
      }
    }, 500);
  }

  /**
   * Stop polling for saved content
   */
  private stopPollingForSave(): void {
    if (this.pollIntervalId !== null) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = null;
    }
  }

  /**
   * Save edited block content
   */
  private async saveBlock(block: MemoryBlock, newContent: string): Promise<void> {
    // Extract projectName from filename for project blocks
    let projectName: string | undefined;
    if (block.type === 'project') {
      projectName = block.filename.replace('memory_project_', '').replace('.md', '');
    }

    try {
      await this.blockManager.updateBlock(block.type, newContent, projectName);
      // Refresh the block list to show updated content
      await this.renderMemoryBlocks();
    } catch (error) {
      console.error('Failed to save memory block:', error);
      this.showStatusMessage('Failed to save memory block. Content may exceed the character limit.', 'error');
    }
  }

  save(): void {
    // Memory settings are auto-saved on checkbox change
  }

  cleanup(): void {
    // Stop any active polling
    this.stopPollingForSave();
  }

  /**
   * Show an inline status message
   */
  private showStatusMessage(message: string, type: 'error' | 'success'): void {
    if (!this.statusMessageElement) {
      return;
    }

    this.statusMessageElement.textContent = message;
    this.statusMessageElement.className = `memory-status-message ${type}`;
    this.statusMessageElement.style.display = 'block';

    // Auto-hide after 4 seconds
    setTimeout(() => {
      if (this.statusMessageElement) {
        this.statusMessageElement.style.display = 'none';
      }
    }, 4000);
  }
}
