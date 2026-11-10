// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Agent Studio SPA - Bundled HTML, CSS, and JS for the Agent Studio web app
 *
 * This file exports the complete SPA as strings that can be injected via RenderWebAppTool.
 * The SPA communicates with DevTools via the Mini App protocol:
 * - SPA → DevTools: window.__miniAppBridge_agent_studio(payload) (via Runtime.addBinding)
 * - DevTools → SPA: window.miniApp.dispatch(action) (via Runtime.evaluate)
 * - State access: window.miniApp.getState() returns current state
 */

export const AgentStudioSPA = {
  html: getHTML(),
  css: getCSS(),
  js: getJS(),
};

function getHTML(): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Studio</title>
</head>
<body>
  <div class="agent-studio">
    <!-- Header -->
    <header class="studio-header">
      <div class="header-left">
        <span class="studio-icon">🤖</span>
        <h1 class="studio-title">Agent Studio</h1>
      </div>
      <button class="close-btn" id="close-btn" title="Close Agent Studio">✕</button>
    </header>

    <!-- Main Content -->
    <div class="studio-content">
      <!-- Left Panel: Agent List -->
      <aside class="agent-list-panel">
        <button class="new-agent-btn" id="new-agent-btn">
          <span>+</span> New Agent
        </button>

        <div class="agent-list-section">
          <h3 class="section-title">Built-in Agents</h3>
          <div class="agent-list" id="built-in-agents">
            <div class="empty-message">Loading...</div>
          </div>
        </div>

        <div class="agent-list-section">
          <h3 class="section-title">Custom Agents</h3>
          <div class="agent-list" id="custom-agents">
            <div class="empty-message">Loading...</div>
          </div>
        </div>
      </aside>

      <!-- Right Panel: Agent Details -->
      <main class="agent-detail-panel" id="agent-detail-panel">
        <div class="empty-detail">
          <div class="empty-icon">🤖</div>
          <h2>Select an Agent</h2>
          <p>Choose an agent from the list to view or edit, or create a new one.</p>
        </div>
      </main>
    </div>

    <!-- Notification Toast -->
    <div id="notification" class="notification hidden"></div>

    <!-- Test Panel (Collapsible) -->
    <div class="test-panel" id="test-panel" style="display: none;">
      <div class="test-panel-header">
        <h3>Test Agent</h3>
        <button class="test-panel-close" id="test-panel-close">✕</button>
      </div>
      <div class="test-panel-content">
        <div class="test-input-group">
          <label for="test-input">Test Query</label>
          <textarea id="test-input" rows="3" placeholder="Enter a test query for the agent..."></textarea>
        </div>
        <button class="btn btn-primary" id="run-test-btn">Run Test</button>
        <div class="test-results" id="test-results">
          <div class="test-results-placeholder">Results will appear here after running a test</div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

function getCSS(): string {
  return `
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      overflow: hidden;
      background: #f0f2f5;
    }

    .agent-studio {
      width: 100vw;
      height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
      background: linear-gradient(135deg, #f5f7fa 0%, #e8ecf1 100%);
    }

    /* Header */
    .studio-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 24px;
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 249, 250, 0.95) 100%);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid rgba(0, 0, 0, 0.08);
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .studio-icon {
      font-size: 28px;
    }

    .studio-title {
      font-size: 20px;
      font-weight: 600;
      color: #202124;
    }

    .close-btn {
      width: 36px;
      height: 36px;
      border: none;
      background: rgba(0, 0, 0, 0.05);
      border-radius: 8px;
      font-size: 18px;
      cursor: pointer;
      transition: all 0.2s;
      color: #5f6368;
    }

    .close-btn:hover {
      background: rgba(220, 53, 69, 0.1);
      color: #dc3545;
    }

    /* Main Content */
    .studio-content {
      display: grid;
      grid-template-columns: 280px 1fr;
      overflow: hidden;
    }

    /* Agent List Panel */
    .agent-list-panel {
      background: rgba(255, 255, 255, 0.95);
      border-right: 1px solid rgba(0, 0, 0, 0.08);
      overflow-y: auto;
      padding: 16px;
    }

    .new-agent-btn {
      width: 100%;
      padding: 12px 16px;
      background: linear-gradient(135deg, #00a4fe 0%, #0093e0 100%);
      color: white;
      border: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 20px;
      box-shadow: 0 2px 8px rgba(0, 164, 254, 0.3);
    }

    .new-agent-btn:hover {
      background: linear-gradient(135deg, #0093e0 0%, #0082c8 100%);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 164, 254, 0.4);
    }

    .agent-list-section {
      margin-bottom: 20px;
    }

    .section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #5f6368;
      margin-bottom: 8px;
      padding: 0 4px;
    }

    .agent-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .agent-list-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s;
      background: transparent;
    }

    .agent-list-item:hover {
      background: rgba(0, 164, 254, 0.08);
    }

    .agent-list-item.selected {
      background: rgba(0, 164, 254, 0.15);
      border: 1px solid rgba(0, 164, 254, 0.3);
    }

    .agent-avatar {
      font-size: 20px;
    }

    .agent-display-name {
      flex: 1;
      font-size: 13px;
      color: #202124;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .agent-badge {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 500;
    }

    .built-in-badge {
      background: rgba(100, 100, 100, 0.1);
      color: #666;
    }

    .empty-message {
      font-size: 12px;
      color: #999;
      padding: 8px 12px;
      font-style: italic;
    }

    /* Agent Detail Panel */
    .agent-detail-panel {
      overflow-y: auto;
      padding: 24px 32px;
    }

    .agent-form {
      max-width: 900px;
      margin: 0 auto;
    }

    .form-section {
      background: rgba(255, 255, 255, 0.95);
      border-radius: 12px;
      padding: 20px 24px;
      margin-bottom: 20px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
    }

    .form-section .section-title {
      font-size: 14px;
      color: #202124;
      margin-bottom: 16px;
      text-transform: none;
      letter-spacing: normal;
    }

    .form-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 16px;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .form-group label {
      font-size: 12px;
      font-weight: 500;
      color: #5f6368;
    }

    .form-group input[type="text"],
    .form-group input[type="number"],
    .form-group textarea {
      padding: 10px 12px;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 14px;
      transition: all 0.2s;
      background: #fff;
    }

    .form-group input:focus,
    .form-group textarea:focus {
      outline: none;
      border-color: #00a4fe;
      box-shadow: 0 0 0 3px rgba(0, 164, 254, 0.15);
    }

    .form-group input:disabled,
    .form-group textarea:disabled {
      background: #f5f5f5;
      color: #999;
      cursor: not-allowed;
    }

    .form-group textarea {
      resize: vertical;
      min-height: 100px;
      font-family: inherit;
    }

    #agent-prompt {
      font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
      font-size: 13px;
      line-height: 1.5;
      min-height: 200px;
    }

    .field-hint {
      font-size: 11px;
      color: #999;
    }

    .avatar-group input {
      width: 60px;
      text-align: center;
      font-size: 20px;
    }

    .color-group {
      max-width: 100px;
    }

    .color-group input[type="color"] {
      width: 100%;
      height: 38px;
      padding: 2px;
      cursor: pointer;
    }

    /* Tools Section */
    .tools-search {
      margin-bottom: 12px;
    }

    .tools-search input {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 14px;
    }

    .tools-list {
      max-height: 300px;
      overflow-y: auto;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      background: #fafafa;
    }

    .tool-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 12px;
      cursor: pointer;
      transition: background 0.15s;
      border-bottom: 1px solid #eee;
    }

    .tool-item:last-child {
      border-bottom: none;
    }

    .tool-item:hover {
      background: rgba(0, 164, 254, 0.05);
    }

    .tool-item.selected {
      background: rgba(0, 164, 254, 0.1);
    }

    .tool-item input[type="checkbox"] {
      margin-top: 3px;
      cursor: pointer;
    }

    .tool-name {
      font-size: 13px;
      font-weight: 500;
      color: #202124;
      min-width: 150px;
    }

    .tool-description {
      font-size: 12px;
      color: #666;
      flex: 1;
    }

    /* Action Buttons */
    .form-actions {
      display: flex;
      gap: 12px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      margin-top: 20px;
    }

    .btn {
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-primary {
      background: linear-gradient(135deg, #00a4fe 0%, #0093e0 100%);
      color: white;
      box-shadow: 0 2px 8px rgba(0, 164, 254, 0.3);
    }

    .btn-primary:hover {
      background: linear-gradient(135deg, #0093e0 0%, #0082c8 100%);
      transform: translateY(-1px);
    }

    .btn-secondary {
      background: #f0f2f5;
      color: #5f6368;
    }

    .btn-secondary:hover {
      background: #e4e6e9;
    }

    .btn-danger {
      background: rgba(220, 53, 69, 0.1);
      color: #dc3545;
    }

    .btn-danger:hover {
      background: rgba(220, 53, 69, 0.2);
    }

    /* Empty State */
    .empty-detail {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #666;
      text-align: center;
    }

    .empty-icon {
      font-size: 64px;
      margin-bottom: 16px;
      opacity: 0.5;
    }

    .empty-detail h2 {
      font-size: 20px;
      margin-bottom: 8px;
      color: #333;
    }

    .empty-detail p {
      font-size: 14px;
    }

    /* Notification Toast */
    .notification {
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      z-index: 1000;
      max-width: 400px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      animation: slideIn 0.3s ease;
    }

    .notification.error {
      background: #ffebee;
      color: #c62828;
      border: 1px solid #ef9a9a;
    }

    .notification.success {
      background: #e8f5e9;
      color: #2e7d32;
      border: 1px solid #a5d6a7;
    }

    .notification.warning {
      background: #fff3e0;
      color: #ef6c00;
      border: 1px solid #ffcc80;
    }

    .notification.hidden {
      display: none;
    }

    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }

    /* Test Panel */
    .test-panel {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: rgba(255, 255, 255, 0.98);
      border-top: 1px solid rgba(0, 0, 0, 0.1);
      box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.1);
      padding: 20px 32px;
      z-index: 100;
    }

    .test-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .test-panel-header h3 {
      font-size: 16px;
      color: #202124;
    }

    .test-panel-close {
      width: 28px;
      height: 28px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 16px;
      color: #666;
      border-radius: 4px;
    }

    .test-panel-close:hover {
      background: rgba(0, 0, 0, 0.05);
    }

    .test-panel-content {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .test-input-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .test-input-group label {
      font-size: 12px;
      font-weight: 500;
      color: #5f6368;
    }

    .test-input-group textarea {
      padding: 10px 12px;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 14px;
      resize: vertical;
    }

    .test-results {
      background: #f5f5f5;
      border-radius: 8px;
      padding: 16px;
      max-height: 200px;
      overflow-y: auto;
    }

    .test-results-placeholder {
      color: #999;
      font-size: 13px;
      text-align: center;
    }

    /* Scrollbar styling */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }

    ::-webkit-scrollbar-track {
      background: transparent;
    }

    ::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 4px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: rgba(0, 0, 0, 0.3);
    }

    /* Dark mode */
    @media (prefers-color-scheme: dark) {
      body {
        background: #1a1d23;
      }

      .agent-studio {
        background: linear-gradient(135deg, #1a1d23 0%, #252931 100%);
      }

      .studio-header {
        background: linear-gradient(135deg, rgba(41, 42, 45, 0.98) 0%, rgba(32, 33, 36, 0.95) 100%);
        border-bottom-color: rgba(255, 255, 255, 0.08);
      }

      .studio-title {
        color: #e8eaed;
      }

      .close-btn {
        background: rgba(255, 255, 255, 0.05);
        color: #9aa0a6;
      }

      .agent-list-panel {
        background: rgba(41, 42, 45, 0.95);
        border-right-color: rgba(255, 255, 255, 0.08);
      }

      .agent-list-item:hover {
        background: rgba(0, 164, 254, 0.15);
      }

      .agent-display-name {
        color: #e8eaed;
      }

      .form-section {
        background: rgba(41, 42, 45, 0.95);
      }

      .form-section .section-title {
        color: #e8eaed;
      }

      .form-group label {
        color: #9aa0a6;
      }

      .form-group input,
      .form-group textarea {
        background: rgba(32, 33, 36, 0.8);
        border-color: rgba(255, 255, 255, 0.1);
        color: #e8eaed;
      }

      .tools-list {
        background: rgba(32, 33, 36, 0.8);
        border-color: rgba(255, 255, 255, 0.1);
      }

      .tool-item {
        border-bottom-color: rgba(255, 255, 255, 0.05);
      }

      .tool-name {
        color: #e8eaed;
      }

      .tool-description {
        color: #9aa0a6;
      }

      .btn-secondary {
        background: rgba(255, 255, 255, 0.08);
        color: #e8eaed;
      }

      .test-panel {
        background: rgba(41, 42, 45, 0.98);
        border-top-color: rgba(255, 255, 255, 0.08);
      }

      .test-results {
        background: rgba(32, 33, 36, 0.8);
      }

      .empty-detail h2 {
        color: #e8eaed;
      }

      .empty-detail p {
        color: #9aa0a6;
      }
    }
  `.trim();
}

function getJS(): string {
  return `
    // Agent Studio SPA - Main Application Logic

    // State
    let state = {
      agents: [],
      tools: [],
      selectedAgent: null,
      isCreatingNew: false,
    };

    // ==========================================
    // Bridge Communication (Mini App Protocol)
    // ==========================================

    // Send action to DevTools (via Runtime.addBinding)
    function sendToDevTools(action) {
      if (typeof window.__miniAppBridge_agent_studio === 'function') {
        window.__miniAppBridge_agent_studio(JSON.stringify(action));
      } else {
        console.error('Bridge not available');
      }
    }

    // Mini App interface - Receive actions from DevTools
    window.miniApp = {
      // Dispatch action from DevTools to SPA
      dispatch: function(message) {
        // Handle both string and object messages
        if (typeof message === 'string') {
          try {
            message = JSON.parse(message);
          } catch (e) {
            console.error('[MiniApp] Failed to parse message:', e);
            return;
          }
        }

        const { action, payload } = message;
        console.log('[MiniApp] Received from DevTools:', action);

        switch (action) {
          case 'init':
            handleInit(payload);
            break;
          case 'agents-updated':
            handleAgentsUpdated(payload);
            break;
          case 'agent-selected':
            handleAgentSelected(payload);
            break;
          case 'notification':
            showNotification(payload.message, payload.type);
            break;
          case 'test-result':
            handleTestResult(payload);
            break;
          // Standard mini app protocol actions
          case 'get-state':
            // State is returned via getState() method
            break;
          case 'set-state':
            state = payload || {};
            renderAgentLists();
            if (state.selectedAgent) {
              renderAgentForm(state.selectedAgent);
            }
            break;
          case 'update-state':
            state = { ...state, ...(payload || {}) };
            renderAgentLists();
            if (state.selectedAgent) {
              renderAgentForm(state.selectedAgent);
            }
            break;
        }
      },

      // Get current state (called by DevTools)
      getState: function() {
        return state;
      },

      // Set entire state
      setState: function(newState) {
        state = newState;
        sendToDevTools({ type: 'state-changed', state: state });
      },

      // Update state partially
      updateState: function(updates) {
        state = { ...state, ...updates };
        sendToDevTools({ type: 'state-changed', state: state });
      },

      // Send action to DevTools
      sendAction: function(type, payload) {
        sendToDevTools({ type, payload });
      },

      // Close the mini app
      close: function() {
        sendToDevTools({ type: 'close' });
      }
    };

    // ==========================================
    // Action Handlers
    // ==========================================

    function handleInit(payload) {
      state.agents = payload.agents || [];
      state.tools = payload.tools || [];
      state.selectedAgent = payload.selectedAgent || null;

      renderAgentLists();
      if (state.selectedAgent) {
        renderAgentForm(state.selectedAgent);
      }
    }

    function handleAgentsUpdated(payload) {
      state.agents = payload.agents || [];
      renderAgentLists();
    }

    function handleAgentSelected(payload) {
      state.selectedAgent = payload.agent;
      state.isCreatingNew = !payload.agent || !payload.agent.name;

      if (payload.agent) {
        renderAgentForm(payload.agent);
      } else {
        renderEmptyState();
      }

      // Update list selection
      updateListSelection(payload.agent?.name);
    }

    function handleTestResult(payload) {
      document.getElementById('test-results').innerHTML = payload.html;
    }

    // ==========================================
    // Rendering Functions
    // ==========================================

    function renderAgentLists() {
      const builtIn = state.agents.filter(a => a.isBuiltIn);
      const custom = state.agents.filter(a => !a.isBuiltIn);

      const builtInContainer = document.getElementById('built-in-agents');
      const customContainer = document.getElementById('custom-agents');

      builtInContainer.innerHTML = builtIn.length
        ? builtIn.map(a => renderAgentListItem(a)).join('')
        : '<div class="empty-message">No built-in agents</div>';

      customContainer.innerHTML = custom.length
        ? custom.map(a => renderAgentListItem(a)).join('')
        : '<div class="empty-message">No custom agents yet</div>';

      // Attach click handlers
      document.querySelectorAll('.agent-list-item').forEach(item => {
        item.addEventListener('click', () => {
          sendToDevTools({
            type: 'select-agent',
            name: item.dataset.agentName,
            id: item.dataset.agentId || null,
            isBuiltIn: item.dataset.isBuiltIn === 'true',
          });
        });
      });
    }

    function renderAgentListItem(agent) {
      const isSelected = state.selectedAgent?.name === agent.name;
      return \`
        <div class="agent-list-item \${isSelected ? 'selected' : ''} \${agent.isBuiltIn ? 'built-in' : ''}"
             data-agent-name="\${escapeHTML(agent.name)}"
             data-agent-id="\${agent.id || ''}"
             data-is-built-in="\${agent.isBuiltIn}">
          <span class="agent-avatar">\${agent.avatar}</span>
          <span class="agent-display-name">\${escapeHTML(agent.displayName)}</span>
          \${agent.isBuiltIn ? '<span class="agent-badge built-in-badge">Built-in</span>' : ''}
        </div>
      \`;
    }

    function updateListSelection(selectedName) {
      document.querySelectorAll('.agent-list-item').forEach(item => {
        item.classList.toggle('selected', item.dataset.agentName === selectedName);
      });
    }

    function renderEmptyState() {
      const panel = document.getElementById('agent-detail-panel');
      panel.innerHTML = \`
        <div class="empty-detail">
          <div class="empty-icon">🤖</div>
          <h2>Select an Agent</h2>
          <p>Choose an agent from the list to view or edit, or create a new one.</p>
        </div>
      \`;
    }

    function renderAgentForm(agent) {
      const isBuiltIn = agent.isBuiltIn;
      const isNew = !agent.name;
      const panel = document.getElementById('agent-detail-panel');

      const toolsHTML = state.tools.map(tool => {
        const isSelected = agent.tools?.includes(tool.name) || false;
        return \`
          <label class="tool-item \${isSelected ? 'selected' : ''}">
            <input type="checkbox" name="tools" value="\${escapeHTML(tool.name)}"
                   \${isSelected ? 'checked' : ''} \${isBuiltIn ? 'disabled' : ''}>
            <span class="tool-name">\${escapeHTML(tool.name)}</span>
            <span class="tool-description">\${escapeHTML(tool.description)}</span>
          </label>
        \`;
      }).join('');

      panel.innerHTML = \`
        <form id="agent-form" class="agent-form">
          <!-- Basic Info Section -->
          <div class="form-section">
            <h3 class="section-title">Basic Information</h3>
            <div class="form-row">
              <div class="form-group">
                <label for="agent-name">Name</label>
                <input type="text" id="agent-name" name="name"
                       value="\${escapeHTML(agent.name || '')}"
                       placeholder="my_custom_agent"
                       pattern="[a-z][-a-z0-9_]*"
                       \${isBuiltIn ? 'disabled' : ''}
                       required>
                <span class="field-hint">Lowercase letters, numbers, underscores, and hyphens</span>
              </div>
              <div class="form-group">
                <label for="agent-display-name">Display Name</label>
                <input type="text" id="agent-display-name" name="displayName"
                       value="\${escapeHTML(agent.displayName || '')}"
                       placeholder="My Custom Agent"
                       \${isBuiltIn ? 'disabled' : ''}
                       required>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group avatar-group">
                <label for="agent-avatar">Avatar</label>
                <input type="text" id="agent-avatar" name="avatar"
                       value="\${agent.avatar || '🤖'}"
                       maxlength="4"
                       \${isBuiltIn ? 'disabled' : ''}>
              </div>
              <div class="form-group color-group">
                <label for="agent-color">Color</label>
                <input type="color" id="agent-color" name="color"
                       value="\${agent.color || '#00a4fe'}"
                       \${isBuiltIn ? 'disabled' : ''}>
              </div>
            </div>

            <div class="form-group">
              <label for="agent-description">Description</label>
              <textarea id="agent-description" name="description" rows="2"
                        placeholder="Brief description of what this agent does"
                        \${isBuiltIn ? 'disabled' : ''}>\${escapeHTML(agent.description || '')}</textarea>
            </div>
          </div>

          <!-- System Prompt Section -->
          <div class="form-section">
            <h3 class="section-title">System Prompt</h3>
            <div class="form-group">
              <textarea id="agent-prompt" name="systemPrompt" rows="12"
                        placeholder="Enter the system prompt that defines how this agent behaves..."
                        \${isBuiltIn ? 'disabled' : ''}
                        required>\${escapeHTML(agent.systemPrompt || '')}</textarea>
              <span class="field-hint">\${isBuiltIn ? 'Built-in agents cannot be edited' : "Instructions that guide the agent's behavior"}</span>
            </div>
          </div>

          <!-- Tools Section -->
          <div class="form-section">
            <h3 class="section-title">Available Tools</h3>
            <div class="tools-search">
              <input type="text" id="tools-search" placeholder="Search tools..." \${isBuiltIn ? 'disabled' : ''}>
            </div>
            <div class="tools-list" id="tools-list">
              \${toolsHTML}
            </div>
          </div>

          <!-- Advanced Settings -->
          <div class="form-section">
            <h3 class="section-title">Advanced Settings</h3>
            <div class="form-row">
              <div class="form-group">
                <label for="agent-max-iterations">Max Iterations</label>
                <input type="number" id="agent-max-iterations" name="maxIterations"
                       value="\${agent.maxIterations || 10}"
                       min="1" max="100"
                       \${isBuiltIn ? 'disabled' : ''}>
              </div>
              <div class="form-group">
                <label for="agent-temperature">Temperature</label>
                <input type="number" id="agent-temperature" name="temperature"
                       value="\${agent.temperature || 0}"
                       min="0" max="2" step="0.1"
                       \${isBuiltIn ? 'disabled' : ''}>
              </div>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="form-actions">
            \${isBuiltIn ? \`
              <button type="button" class="btn btn-secondary" id="clone-btn">
                Clone as Custom
              </button>
            \` : \`
              <button type="submit" class="btn btn-primary" id="save-btn">
                \${isNew ? 'Create Agent' : 'Save Changes'}
              </button>
              <button type="button" class="btn btn-secondary" id="test-btn">
                Test Agent
              </button>
              \${!isNew ? \`
                <button type="button" class="btn btn-danger" id="delete-btn">
                  Delete Agent
                </button>
              \` : ''}
            \`}
          </div>
        </form>
      \`;

      // Attach form event handlers
      attachFormHandlers(agent);
    }

    function attachFormHandlers(agent) {
      const form = document.getElementById('agent-form');
      const isBuiltIn = agent.isBuiltIn;

      // Form submission
      form?.addEventListener('submit', (e) => {
        e.preventDefault();
        handleSave();
      });

      // Clone button
      document.getElementById('clone-btn')?.addEventListener('click', () => {
        sendToDevTools({ type: 'clone-agent' });
      });

      // Delete button
      document.getElementById('delete-btn')?.addEventListener('click', () => {
        if (confirm('Are you sure you want to delete this agent? This action cannot be undone.')) {
          sendToDevTools({ type: 'delete-agent' });
        }
      });

      // Test button
      document.getElementById('test-btn')?.addEventListener('click', () => {
        document.getElementById('test-panel').style.display = 'block';
      });

      // Tools search
      document.getElementById('tools-search')?.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        document.querySelectorAll('.tool-item').forEach(item => {
          const name = item.querySelector('.tool-name').textContent.toLowerCase();
          const desc = item.querySelector('.tool-description').textContent.toLowerCase();
          item.style.display = (name.includes(searchTerm) || desc.includes(searchTerm)) ? 'flex' : 'none';
        });
      });

      // Tool checkbox visual update
      document.querySelectorAll('.tool-item input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', (e) => {
          e.target.closest('.tool-item').classList.toggle('selected', e.target.checked);
        });
      });
    }

    function handleSave() {
      const form = document.getElementById('agent-form');
      const formData = new FormData(form);

      // Collect selected tools
      const selectedTools = [];
      form.querySelectorAll('input[name="tools"]:checked').forEach(cb => {
        selectedTools.push(cb.value);
      });

      const agentData = {
        name: formData.get('name'),
        displayName: formData.get('displayName'),
        description: formData.get('description'),
        avatar: formData.get('avatar') || '🤖',
        color: formData.get('color') || '#00a4fe',
        systemPrompt: formData.get('systemPrompt'),
        tools: selectedTools,
        maxIterations: parseInt(formData.get('maxIterations') || '10', 10),
        temperature: parseFloat(formData.get('temperature') || '0'),
        schema: state.selectedAgent?.schema || { type: 'object', properties: {} },
      };

      sendToDevTools({
        type: 'save-agent',
        data: agentData,
      });
    }

    // ==========================================
    // Notification
    // ==========================================

    function showNotification(message, type) {
      type = type || 'error';
      const el = document.getElementById('notification');
      if (!el) return;
      el.textContent = message;
      el.className = 'notification ' + type;
      setTimeout(() => el.classList.add('hidden'), 4000);
    }

    // ==========================================
    // Utilities
    // ==========================================

    function escapeHTML(str) {
      return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // ==========================================
    // Initialization
    // ==========================================

    function init() {
      // Close button
      document.getElementById('close-btn')?.addEventListener('click', () => {
        sendToDevTools({ type: 'close' });
      });

      // New agent button
      document.getElementById('new-agent-btn')?.addEventListener('click', () => {
        sendToDevTools({ type: 'new-agent' });
      });

      // Test panel close
      document.getElementById('test-panel-close')?.addEventListener('click', () => {
        document.getElementById('test-panel').style.display = 'none';
      });

      // Run test button
      document.getElementById('run-test-btn')?.addEventListener('click', () => {
        const input = document.getElementById('test-input').value.trim();
        if (!input) {
          showNotification('Please enter a test query', 'warning');
          return;
        }
        document.getElementById('test-results').innerHTML = '<div class="test-results-placeholder">Running test...</div>';
        sendToDevTools({ type: 'run-test', query: input });
      });

      // Signal ready to receive data
      sendToDevTools({ type: 'ready' });
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  `.trim();
}
