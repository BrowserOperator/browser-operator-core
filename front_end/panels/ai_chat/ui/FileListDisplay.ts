// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as ComponentHelpers from '../../../ui/components/helpers/helpers.js';
import * as Lit from '../../../ui/lit/lit.js';
import { FileStorageManager, type FileSummary } from '../tools/FileStorageManager.js';
import { createLogger } from '../core/Logger.js';
import { AgentService } from '../core/AgentService.js';

const logger = createLogger('FileListDisplay');

const {html, nothing} = Lit;

/**
 * Component that displays a list of files created during the agent session
 */
export class FileListDisplay extends HTMLElement {
  static readonly litTagName = Lit.StaticHtml.literal`ai-file-list-display`;
  readonly #shadow = this.attachShadow({mode: 'open'});
  readonly #boundRender = this.#render.bind(this);

  #files: FileSummary[] = [];
  #isCollapsed = false;
  #viewingFile: FileSummary | null = null;
  #viewingFileContent: string | null = null;
  #refreshInterval?: number;
  #boundHandleKeyDown = this.#handleKeyDown.bind(this);

  get files(): FileSummary[] {
    return this.#files;
  }

  set files(value: FileSummary[]) {
    this.#files = value;
    void ComponentHelpers.ScheduledRender.scheduleRender(this, this.#boundRender);
  }

  get isCollapsed(): boolean {
    return this.#isCollapsed;
  }

  set isCollapsed(value: boolean) {
    this.#isCollapsed = value;
    void ComponentHelpers.ScheduledRender.scheduleRender(this, this.#boundRender);
  }

  get viewingFile(): FileSummary | null {
    return this.#viewingFile;
  }

  set viewingFile(value: FileSummary | null) {
    this.#viewingFile = value;
    void ComponentHelpers.ScheduledRender.scheduleRender(this, this.#boundRender);
  }

  get viewingFileContent(): string | null {
    return this.#viewingFileContent;
  }

  set viewingFileContent(value: string | null) {
    this.#viewingFileContent = value;
    void ComponentHelpers.ScheduledRender.scheduleRender(this, this.#boundRender);
  }

  connectedCallback(): void {
    // Load collapsed state from localStorage
    const savedState = localStorage.getItem('ai_chat_files_collapsed');
    this.#isCollapsed = savedState === 'true';

    this.#loadFiles();
    // Poll for updates every 2 seconds
    this.#refreshInterval = window.setInterval(() => this.#loadFiles(), 2000);
    void ComponentHelpers.ScheduledRender.scheduleRender(this, this.#boundRender);
  }

  disconnectedCallback(): void {
    if (this.#refreshInterval) {
      clearInterval(this.#refreshInterval);
      this.#refreshInterval = undefined;
    }
    // Clean up keydown listener if modal was open when component was removed
    document.removeEventListener('keydown', this.#boundHandleKeyDown);
  }

  async #loadFiles(): Promise<void> {
    // Don't load files if the element is no longer connected to the DOM
    if (!this.isConnected) {
      return;
    }
    try {
      const manager = FileStorageManager.getInstance();
      const files = await manager.listFiles();

      // Only update if files have actually changed (avoid unnecessary re-renders)
      const filesChanged = files.length !== this.#files.length ||
        files.some((file, index) =>
          file.fileName !== this.#files[index]?.fileName ||
          file.updatedAt !== this.#files[index]?.updatedAt
        );

      if (filesChanged) {
        this.#files = files;
        void ComponentHelpers.ScheduledRender.scheduleRender(this, this.#boundRender);
      }
    } catch (error) {
      logger.error('Failed to load files', error);
    }
  }

  #toggleCollapse(): void {
    this.#isCollapsed = !this.#isCollapsed;
    localStorage.setItem('ai_chat_files_collapsed', String(this.#isCollapsed));
    void ComponentHelpers.ScheduledRender.scheduleRender(this, this.#boundRender);
  }

  async #handleViewFile(file: FileSummary): Promise<void> {
    try {
      const manager = FileStorageManager.getInstance();
      const storedFile = await manager.readFile(file.fileName);
      if (!storedFile) {
        logger.error('File not found', file.fileName);
        return;
      }

      // Check if agent is running
      const agentRunning = AgentService.instance?.isRunning() ?? false;

      if (!agentRunning) {
        // Full-screen viewer (browser iframe) when agent is idle
        logger.info('Opening full-screen file viewer (agent idle)', { fileName: file.fileName });
        const { FileContentViewer } = await import('./FileContentViewer.js');
        await FileContentViewer.show(file, storedFile.content);
      } else {
        // Current modal behavior when agent is running (don't interrupt)
        logger.info('Opening modal file viewer (agent running)', { fileName: file.fileName });
        this.#viewingFile = file;
        this.#viewingFileContent = storedFile.content;
        // Add ESC key listener when modal opens
        document.addEventListener('keydown', this.#boundHandleKeyDown);
        void ComponentHelpers.ScheduledRender.scheduleRender(this, this.#boundRender);
      }
    } catch (error) {
      logger.error('Failed to read file', error);
    }
  }

  #handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.#viewingFile) {
      this.#closeModal();
    }
  }

  #handleDownloadFile(file: FileSummary): void {
    FileStorageManager.getInstance().readFile(file.fileName).then(storedFile => {
      if (!storedFile) {
        logger.error('File not found', file.fileName);
        return;
      }

      const blob = new Blob([storedFile.content], { type: storedFile.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.fileName;
      a.click();
      URL.revokeObjectURL(url);
    }).catch(error => {
      logger.error('Failed to download file', error);
    });
  }

  #closeModal(): void {
    this.#viewingFile = null;
    this.#viewingFileContent = null;
    // Remove ESC key listener when modal closes
    document.removeEventListener('keydown', this.#boundHandleKeyDown);
    void ComponentHelpers.ScheduledRender.scheduleRender(this, this.#boundRender);
  }

  #formatFileSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  #formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    // Less than 1 minute
    if (diff < 60000) {
      return 'just now';
    }
    // Less than 1 hour
    if (diff < 3600000) {
      const minutes = Math.floor(diff / 60000);
      return `${minutes}m ago`;
    }
    // Less than 1 day
    if (diff < 86400000) {
      const hours = Math.floor(diff / 3600000);
      return `${hours}h ago`;
    }
    // Otherwise show date
    return date.toLocaleDateString();
  }

  #render(): void {
    if (this.#files.length === 0) {
      Lit.render(nothing, this.#shadow, {host: this});
      return;
    }

    Lit.render(html`
      <style>
        :host {
          display: block;
        }

        .file-list-container {
          height: ${this.#isCollapsed ? '44px' : 'auto'};
          max-height: ${this.#isCollapsed ? '44px' : '160px'};
          display: flex;
          flex-direction: column;
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(10px);
          border-radius: 20px;
          box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.08);
          border: 1px solid var(--color-background-elevation-1, rgba(0, 0, 0, 0.06));
          margin: 0 8px 8px 8px;
          overflow: hidden;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .file-list-header {
          padding: 12px 20px;
          background: transparent;
          cursor: pointer;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid rgba(0, 0, 0, 0.06);
          flex-shrink: 0;
          user-select: none;
          height: 44px;
          box-sizing: border-box;
          transition: background 0.2s ease;
        }

        .file-list-header:hover {
          background: rgba(0, 0, 0, 0.03);
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 10px;
          font-weight: 600;
          font-size: 11px;
          color: var(--color-text-primary, #202124);
          letter-spacing: -0.01em;
        }

        .header-icon {
          font-size: 15px;
        }

        .header-count {
          font-size: 10px;
          opacity: 0.6;
          font-weight: 500;
          color: var(--color-primary, #1976d2);
        }

        .toggle-icon {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          background: rgba(0, 0, 0, 0.04);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          font-size: 7px;
          color: var(--color-text-secondary, #5f6368);
          transform: ${this.#isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)'};
        }

        .toggle-icon:hover {
          background: rgba(0, 0, 0, 0.08);
          transform: ${this.#isCollapsed ? 'rotate(-90deg) scale(1.05)' : 'rotate(0deg) scale(1.05)'};
        }

        .files-content {
          padding: 4px 20px 16px 20px;
          overflow-x: auto;
          overflow-y: hidden;
        }

        .files-content::-webkit-scrollbar {
          height: 4px;
        }

        .files-content::-webkit-scrollbar-track {
          background: transparent;
        }

        .files-content::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.15);
          border-radius: 2px;
        }

        .files-content::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.25);
        }

        .files-list {
          display: flex;
          gap: 8px;
          padding: 4px 0;
        }

        .file-chip {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          background: rgba(0, 0, 0, 0.03);
          border-radius: 12px;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          white-space: nowrap;
          font-size: 11px;
          font-weight: 500;
          color: var(--color-text-primary, #202124);
          border: 1px solid transparent;
        }

        .file-chip:hover {
          background: rgba(0, 0, 0, 0.06);
          transform: translateY(-1px);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }

        .file-chip:active {
          transform: translateY(0);
        }

        .file-icon {
          font-size: 13px;
        }

        .file-name {
          max-width: 200px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
          animation: fadeIn 0.2s ease;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .modal-content {
          background: var(--sys-color-surface, white);
          border-radius: 16px;
          padding: 0;
          max-width: 90vw;
          max-height: 90vh;
          overflow: hidden;
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
          display: flex;
          flex-direction: column;
          animation: slideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 20px 24px;
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
          flex-shrink: 0;
        }

        .modal-title-group {
          flex: 1;
          min-width: 0;
        }

        .modal-title {
          font-weight: 600;
          font-size: 16px;
          color: var(--color-text-primary, #202124);
          margin-bottom: 4px;
          word-break: break-word;
        }

        .modal-meta {
          font-size: 11px;
          color: var(--color-text-secondary, #5f6368);
          display: flex;
          gap: 16px;
        }

        .modal-actions {
          display: flex;
          gap: 8px;
          margin-left: 16px;
        }

        .modal-button {
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 11px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          display: flex;
          align-items: center;
          gap: 6px;
          border: none;
          white-space: nowrap;
        }

        .download-button {
          background: var(--color-primary, #1976d2);
          color: white;
        }

        .download-button:hover {
          background: var(--color-primary-1, #1565c0);
          box-shadow: 0 2px 8px rgba(25, 118, 210, 0.3);
        }

        .close-button {
          background: rgba(0, 0, 0, 0.05);
          color: var(--color-text-primary, #202124);
          padding: 8px 12px;
        }

        .close-button:hover {
          background: rgba(0, 0, 0, 0.1);
        }

        .file-content-viewer {
          background: var(--sys-color-surface2, #f8f9fa);
          padding: 24px;
          white-space: pre-wrap;
          font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
          font-size: 12px;
          line-height: 1.6;
          overflow: auto;
          flex: 1;
          color: var(--color-text-primary, #202124);
        }

        .file-content-viewer::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }

        .file-content-viewer::-webkit-scrollbar-track {
          background: transparent;
        }

        .file-content-viewer::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 4px;
        }

        .file-content-viewer::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.3);
        }

        /* Dark mode support */
        @media (prefers-color-scheme: dark) {
          .file-list-container {
            background: rgba(30, 30, 30, 0.95);
            border: 1px solid rgba(255, 255, 255, 0.08);
          }

          .file-list-header {
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          }

          .file-list-header:hover {
            background: rgba(255, 255, 255, 0.05);
          }

          .header-left {
            color: #e8eaed;
          }

          .toggle-icon {
            background: rgba(255, 255, 255, 0.08);
            color: #9aa0a6;
          }

          .toggle-icon:hover {
            background: rgba(255, 255, 255, 0.12);
          }

          .file-chip {
            background: rgba(255, 255, 255, 0.05);
            color: #e8eaed;
          }

          .file-chip:hover {
            background: rgba(255, 255, 255, 0.1);
          }

          .modal-overlay {
            background: rgba(0, 0, 0, 0.8);
          }

          .modal-content {
            background: #202124;
          }

          .modal-header {
            border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          }

          .modal-title {
            color: #e8eaed;
          }

          .modal-meta {
            color: #9aa0a6;
          }

          .close-button {
            background: rgba(255, 255, 255, 0.08);
            color: #e8eaed;
          }

          .close-button:hover {
            background: rgba(255, 255, 255, 0.12);
          }

          .file-content-viewer {
            background: #292a2d;
            color: #e8eaed;
          }
        }
      </style>

      <div class="file-list-container">
        <div class="file-list-header" @click=${() => this.#toggleCollapse()}>
          <div class="header-left">
            <span class="header-icon">📁</span>
            <span>Session Files</span>
            <span class="header-count"> • ${this.#files.length}</span>
          </div>
          <div class="toggle-icon">
            ▼
          </div>
        </div>

        ${!this.#isCollapsed ? html`
          <div class="files-content">
            <div class="files-list">
              ${this.#files.map(file => html`
                <div class="file-chip" @click=${() => this.#handleViewFile(file)}>
                  <span class="file-icon">📄</span>
                  <span class="file-name">${file.fileName}</span>
                </div>
              `)}
            </div>
          </div>
        ` : nothing}
      </div>

      ${this.#viewingFile && this.#viewingFileContent ? html`
        <div class="modal-overlay" @click=${(e: Event) => {
          if (e.target === e.currentTarget) {
            this.#closeModal();
          }
        }}>
          <div class="modal-content" @click=${(e: Event) => e.stopPropagation()}>
            <div class="modal-header">
              <div class="modal-title-group">
                <div class="modal-title">${this.#viewingFile.fileName}</div>
                <div class="modal-meta">
                  <span>${this.#formatFileSize(this.#viewingFile.size)}</span>
                  <span>Created ${this.#formatTimestamp(this.#viewingFile.createdAt)}</span>
                </div>
              </div>
              <div class="modal-actions">
                <button class="modal-button download-button" @click=${() => this.#handleDownloadFile(this.#viewingFile!)}>
                  <span>⬇️</span>
                  <span>Download</span>
                </button>
                <button class="modal-button close-button" @click=${() => this.#closeModal()}>
                  Close
                </button>
              </div>
            </div>
            <div class="file-content-viewer">${this.#viewingFileContent}</div>
          </div>
        </div>
      ` : nothing}
    `, this.#shadow, {host: this});
  }

  /**
   * Public method to refresh the file list
   */
  async refresh(): Promise<void> {
    await this.#loadFiles();
  }
}

customElements.define('ai-file-list-display', FileListDisplay);

declare global {
  interface HTMLElementTagNameMap {
    'ai-file-list-display': FileListDisplay;
  }
}
