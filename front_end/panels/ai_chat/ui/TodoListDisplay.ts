// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Lit from '../../../ui/lit/lit.js';
import { FileStorageManager } from '../tools/FileStorageManager.js';
import { createLogger } from '../core/Logger.js';

const logger = createLogger('TodoListDisplay');
const {html, Decorators, render} = Lit;
const {customElement} = Decorators;

interface TodoItem {
  completed: boolean;
  text: string;
}

interface ParsedTodos {
  items: TodoItem[];
  total: number;
  completed: number;
}

@customElement('ai-todo-list')
export class TodoListDisplay extends HTMLElement {
  static readonly litTagName = Lit.StaticHtml.literal`ai-todo-list`;
  readonly #shadow = this.attachShadow({mode: 'open'});

  #collapsed = false;
  #todos = '';
  #refreshInterval?: number;

  connectedCallback(): void {
    // Load collapsed state from localStorage
    const savedState = localStorage.getItem('ai_chat_todo_collapsed');
    this.#collapsed = savedState === 'true';

    this.#loadTodos();
    // Poll for updates every 2 seconds
    this.#refreshInterval = window.setInterval(() => this.#loadTodos(), 2000);
  }

  disconnectedCallback(): void {
    if (this.#refreshInterval) {
      clearInterval(this.#refreshInterval);
      this.#refreshInterval = undefined;
    }
  }

  async #loadTodos(): Promise<void> {
    // Don't load todos if the element is no longer connected to the DOM
    if (!this.isConnected) {
      return;
    }
    try {
      const file = await FileStorageManager.getInstance().readFile('todos.md');
      const newContent = file?.content || '';

      if (newContent !== this.#todos) {
        this.#todos = newContent;
        this.#render();
      }
    } catch (error) {
      logger.debug('Failed to load todos:', error);
    }
  }

  #toggleCollapse(): void {
    this.#collapsed = !this.#collapsed;
    localStorage.setItem('ai_chat_todo_collapsed', String(this.#collapsed));
    this.#render();
  }

  #parseTodos(markdown: string): ParsedTodos {
    const lines = markdown.split('\n');
    const items = lines
      .filter(line => /^[\s]*-\s+\[([ x])\]/i.test(line))
      .map(line => ({
        completed: /\[x\]/i.test(line),
        text: line.replace(/^[\s]*-\s+\[([ x])\]\s*/i, '').trim()
      }))
      .filter(item => item.text.length > 0);

    return {
      items,
      total: items.length,
      completed: items.filter(i => i.completed).length
    };
  }

  #render(): void {
    // Don't render if no todos exist
    if (!this.#todos || this.#todos.trim().length === 0) {
      render(html``, this.#shadow, {host: this});
      return;
    }

    const todoItems = this.#parseTodos(this.#todos);

    // Don't render if no valid todo items
    if (todoItems.total === 0) {
      render(html``, this.#shadow, {host: this});
      return;
    }

    render(html`
      <style>
        :host {
          display: block;
        }

        .todo-container {
          height: ${this.#collapsed ? '44px' : '200px'};
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

        .todo-header {
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

        .todo-header:hover {
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
          transform: ${this.#collapsed ? 'rotate(-90deg)' : 'rotate(0deg)'};
        }

        .toggle-icon:hover {
          background: rgba(0, 0, 0, 0.08);
          transform: ${this.#collapsed ? 'rotate(-90deg) scale(1.05)' : 'rotate(0deg) scale(1.05)'};
        }

        .todo-content {
          padding: 4px 20px 16px 20px;
          max-height: 156px;
          overflow-y: auto;
        }

        .todo-content::-webkit-scrollbar {
          width: 4px;
        }

        .todo-content::-webkit-scrollbar-track {
          background: transparent;
        }

        .todo-content::-webkit-scrollbar-thumb {
          background: rgba(0, 0, 0, 0.15);
          border-radius: 2px;
        }

        .todo-content::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 0, 0, 0.25);
        }

        .todo-item {
          padding: 4px 0;
          display: flex;
          gap: 8px;
          align-items: center;
          font-size: 10px;
          line-height: 1.5;
          color: var(--color-text-primary, #202124);
        }

        .todo-checkbox {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          border: 1.5px solid rgba(0, 0, 0, 0.2);
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 7px;
          transition: all 0.2s ease;
          background: transparent;
        }

        .todo-item.completed .todo-checkbox {
          background: var(--color-primary, #1976d2);
          border-color: var(--color-primary, #1976d2);
          color: white;
        }

        .todo-item.completed {
          opacity: 0.5;
        }

        .todo-item.completed .todo-text {
          text-decoration: line-through;
          color: var(--color-text-secondary, #5f6368);
        }

        .todo-text {
          flex: 1;
          word-break: break-word;
        }

        /* Dark mode support */
        @media (prefers-color-scheme: dark) {
          .todo-container {
            background: rgba(30, 30, 30, 0.95);
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.3);
          }

          .todo-header {
            border-bottom: 1px solid rgba(255, 255, 255, 0.06);
          }

          .todo-header:hover {
            background: rgba(255, 255, 255, 0.05);
          }

          .toggle-icon {
            background: rgba(255, 255, 255, 0.08);
          }

          .toggle-icon:hover {
            background: rgba(255, 255, 255, 0.12);
          }

          .todo-checkbox {
            border-color: rgba(255, 255, 255, 0.3);
          }

          .todo-content::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.2);
          }

          .todo-content::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.3);
          }
        }
      </style>

      <div class="todo-container">
        <div class="todo-header" @click=${() => this.#toggleCollapse()}>
          <div class="header-left">
            <span class="header-icon">📋</span>
            <span>Tasks</span>
            <span class="header-count">${todoItems.completed}/${todoItems.total}</span>
          </div>
          <span class="toggle-icon">▼</span>
        </div>
        ${!this.#collapsed ? html`
          <div class="todo-content">
            ${todoItems.items.map(item => html`
              <div class="todo-item ${item.completed ? 'completed' : ''}">
                <span class="todo-checkbox">${item.completed ? '✓' : ''}</span>
                <span class="todo-text">${item.text}</span>
              </div>
            `)}
          </div>
        ` : ''}
      </div>
    `, this.#shadow, {host: this});
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ai-todo-list': TodoListDisplay;
  }
}
