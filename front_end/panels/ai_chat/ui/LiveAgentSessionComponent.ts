// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Lit from '../../../ui/lit/lit.js';
import { getAgentUIConfig } from '../agent_framework/AgentSessionTypes.js';
import type { AgentSession, AgentMessage } from '../agent_framework/AgentSessionTypes.js';

const {html, Decorators} = Lit;
const {customElement} = Decorators;

@customElement('live-agent-session')
export class LiveAgentSessionComponent extends HTMLElement {
  static readonly litTagName = Lit.StaticHtml.literal`live-agent-session`;
  private readonly shadow = this.attachShadow({mode: 'open'});
  
  private session: AgentSession | null = null;
  private isExpanded = true; // Auto-expand for live sessions
  private toolElements = new Map<string, HTMLElement>();
  private childComponents = new Map<string, LiveAgentSessionComponent>();
  
  connectedCallback(): void {
    this.render();
  }
  
  setSession(session: AgentSession): void {
    this.session = session;
    this.render();
  }
  
  addToolCall(toolCall: AgentMessage): void {
    if (!this.session) return;
    
    // Create tool element with running state
    const toolElement = this.createToolElement(toolCall, 'running');
    this.toolElements.set(toolCall.id, toolElement);
    
    // Insert into timeline
    const timeline = this.shadow.querySelector('.timeline-items');
    if (timeline) {
      timeline.appendChild(toolElement);
    }
  }
  
  updateToolResult(toolResult: AgentMessage): void {
    const toolCallId = (toolResult.content as any).toolCallId;
    const toolElement = this.toolElements.get(toolCallId);
    
    if (toolElement) {
      // Update status indicator
      const statusEl = toolElement.querySelector('.tool-status');
      if (statusEl) {
        statusEl.className = 'tool-status ' + ((toolResult.content as any).success ? 'completed' : 'error');
        statusEl.textContent = (toolResult.content as any).success ? '✓' : '❌';
      }
    }
  }
  
  addChildSession(sessionId: string, childComponent: LiveAgentSessionComponent): void {
    this.childComponents.set(sessionId, childComponent);
    
    // Add to DOM
    let nestedContainer = this.shadow.querySelector('.nested-sessions');
    if (!nestedContainer) {
      // Create container if it doesn't exist
      nestedContainer = document.createElement('div');
      nestedContainer.className = 'nested-sessions';
      this.shadow.querySelector('.agent-session-container')?.appendChild(nestedContainer);
    }
    
    // Add visual indicator for nesting
    const wrapper = document.createElement('div');
    wrapper.className = 'nested-agent-wrapper';
    wrapper.innerHTML = `
      <div class="nesting-indicator">
        <span class="nesting-arrow">↳</span>
        <span class="nesting-label">Called ${childComponent.session?.agentName}</span>
      </div>
    `;
    wrapper.appendChild(childComponent);
    nestedContainer.appendChild(wrapper);
  }
  
  private createToolElement(toolCall: AgentMessage, status: 'running' | 'completed' | 'error'): HTMLElement {
    const div = document.createElement('div');
    div.className = 'timeline-item';
    
    const content = toolCall.content as any;
    const statusIcon = status === 'running' ? '⏳' : status === 'completed' ? '✓' : '❌';
    
    div.innerHTML = `
      <div class="tool-line">
        <span class="tool-status ${status}">${statusIcon}</span>
        <span class="tool-name">${content.toolName}</span>
      </div>
    `;
    
    return div;
  }
  
  private render(): void {
    if (!this.session) return;
    
    const uiConfig = getAgentUIConfig(this.session.agentName, this.session.config);
    
    Lit.render(html`
      <style>
        .agent-session-container {
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          margin: 8px 0;
          padding: 12px;
          background: #f9fafb;
        }
        .agent-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
          font-weight: 500;
        }
        .agent-title {
          color: #374151;
        }
        .live-indicator {
          background: #ef4444;
          color: white;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.75em;
          font-weight: 500;
        }
        .nested-badge {
          background: #f59e0b;
          color: white;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.75em;
        }
        .top-level-badge {
          background: #10b981;
          color: white;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 0.75em;
        }
        .timeline-items {
          display: block !important;
          margin-left: 16px;
        }
        .timeline-item {
          margin: 4px 0;
        }
        .tool-line {
          display: flex;
          align-items: center;
          gap: 8px;
          font-family: monospace;
          font-size: 0.875em;
        }
        .tool-status {
          min-width: 20px;
          text-align: center;
        }
        .tool-status.running { 
          color: #f59e0b; 
        }
        .tool-status.completed { 
          color: #10b981; 
        }
        .tool-status.error { 
          color: #ef4444; 
        }
        .tool-name {
          color: #6b7280;
        }
        .nested-sessions {
          margin-left: 20px;
          border-left: 2px solid #e5e7eb;
          padding-left: 10px;
          margin-top: 12px;
        }
        .nested-agent-wrapper {
          margin-top: 10px;
        }
        .nesting-indicator {
          color: #6b7280;
          font-size: 0.875em;
          margin-bottom: 5px;
        }
        .nesting-arrow {
          margin-right: 4px;
        }
      </style>
      
      <div class="agent-session-container">
        <div class="agent-header">
          <div class="agent-title">${uiConfig.displayName}</div>
          <span class="live-indicator">🔴 LIVE</span>
          ${this.session?.parentSessionId ? 
            html`<span class="nested-badge">Nested</span>` : 
            html`<span class="top-level-badge">Top Level</span>`
          }
        </div>
        <div class="timeline-items">
          <!-- Tool calls will be inserted here dynamically -->
        </div>
        <!-- Child sessions will be inserted here -->
      </div>
    `, this.shadow);
  }
}