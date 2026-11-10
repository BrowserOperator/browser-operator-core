// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import http from 'http';
import url from 'url';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { v4 as uuidv4 } from 'uuid';

import logger from './logger.js';
// No need to import BrowserAgentServer - it's passed as constructor parameter

class APIServer {
  constructor(browserAgentServer, port = 8081) {
    this.browserAgentServer = browserAgentServer;
    this.port = port;
    this.server = null;
    this.configDefaults = null;
    this.loadConfigDefaults();
  }

  /**
   * Load default model configuration from config.yaml
   */
  loadConfigDefaults() {
    try {
      const configPath = path.resolve('./evals/config.yaml');
      if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf8');
        this.configDefaults = yaml.load(configContent);
        logger.info('Loaded config.yaml defaults:', this.configDefaults);
      } else {
        logger.warn('config.yaml not found, using hardcoded defaults');
        this.configDefaults = {
          model: {
            main_model: 'gpt-4.1',
            mini_model: 'gpt-4.1-mini',
            nano_model: 'gpt-4.1-nano',
            provider: 'openai'
          }
        };
      }
    } catch (error) {
      logger.error('Failed to load config.yaml:', error);
      this.configDefaults = {
        model: {
          main_model: 'gpt-4.1',
          mini_model: 'gpt-4.1-mini',
          nano_model: 'gpt-4.1-nano',
          provider: 'openai'
        }
      };
    }
  }

  start() {
    this.server = http.createServer((req, res) => {
      // Enable CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      this.handleRequest(req, res);
    });

    this.server.listen(this.port, () => {
      logger.info(`API server started on http://localhost:${this.port}`);
    });
  }

  async handleRequest(req, res) {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    const method = req.method;

    try {
      // Get body for POST requests
      let body = '';
      if (method === 'POST') {
        for await (const chunk of req) {
          body += chunk;
        }
      }

      let result;

      // Handle dynamic client tabs route
      if (pathname.startsWith('/clients/') && pathname.endsWith('/tabs')) {
        // Handle dynamic client tabs route
        const clientId = pathname.split('/')[2];
        result = this.getClientTabsById(clientId);
      } else {
        switch (pathname) {
          case '/status':
            result = this.getStatus();
            break;

          case '/clients':
            result = this.getClients();
            break;

          case '/tabs/open':
            if (method !== 'POST') {
              this.sendError(res, 405, 'Method not allowed');
              return;
            }
            result = await this.openTab(JSON.parse(body));
            break;

          case '/tabs/close':
            if (method !== 'POST') {
              this.sendError(res, 405, 'Method not allowed');
              return;
            }
            result = await this.closeTab(JSON.parse(body));
            break;

          case '/v1/responses':
            if (method !== 'POST') {
              this.sendError(res, 405, 'Method not allowed');
              return;
            }
            result = await this.handleResponsesRequest(JSON.parse(body));
            break;

          case '/page/content':
            if (method !== 'POST') {
              this.sendError(res, 405, 'Method not allowed');
              return;
            }
            result = await this.getPageContent(JSON.parse(body));
            break;

          case '/page/screenshot':
            if (method !== 'POST') {
              this.sendError(res, 405, 'Method not allowed');
              return;
            }
            result = await this.getScreenshot(JSON.parse(body));
            break;

          case '/page/execute':
            if (method !== 'POST') {
              this.sendError(res, 405, 'Method not allowed');
              return;
            }
            result = await this.executeJavaScript(JSON.parse(body));
            break;

          case '/page/dom-snapshot':
            if (method !== 'POST') {
              this.sendError(res, 405, 'Method not allowed');
              return;
            }
            result = await this.getDOMSnapshot(JSON.parse(body));
            break;

          case '/v1/tools/execute':
            if (method !== 'POST') {
              this.sendError(res, 405, 'Method not allowed');
              return;
            }
            result = await this.executeToolDirect(JSON.parse(body));
            break;

          case '/v1/tools':
            if (method !== 'GET') {
              this.sendError(res, 405, 'Method not allowed');
              return;
            }
            result = this.getAvailableTools();
            break;

          // Convenience endpoints for common actions
          case '/actions/click':
            if (method !== 'POST') {
              this.sendError(res, 405, 'Method not allowed');
              return;
            }
            result = await this.handleActionClick(JSON.parse(body));
            break;

          case '/actions/type':
            if (method !== 'POST') {
              this.sendError(res, 405, 'Method not allowed');
              return;
            }
            result = await this.handleActionType(JSON.parse(body));
            break;

          case '/actions/scroll':
            if (method !== 'POST') {
              this.sendError(res, 405, 'Method not allowed');
              return;
            }
            result = await this.handleActionScroll(JSON.parse(body));
            break;

          case '/actions/navigate':
            if (method !== 'POST') {
              this.sendError(res, 405, 'Method not allowed');
              return;
            }
            result = await this.handleActionNavigate(JSON.parse(body));
            break;

          case '/actions/hover':
            if (method !== 'POST') {
              this.sendError(res, 405, 'Method not allowed');
              return;
            }
            result = await this.handleActionHover(JSON.parse(body));
            break;

          case '/page/accessibility-tree':
            if (method !== 'GET' && method !== 'POST') {
              this.sendError(res, 405, 'Method not allowed');
              return;
            }
            result = await this.getAccessibilityTree(method === 'POST' ? JSON.parse(body) : parsedUrl.query);
            break;

          default:
            this.sendError(res, 404, 'Not found');
            return;
        }
      }

      this.sendResponse(res, 200, result);

    } catch (error) {
      logger.error('API error:', error);
      this.sendError(res, 500, error.message);
    }
  }

  getStatus() {
    const status = this.browserAgentServer.getStatus();
    const clients = this.browserAgentServer.getClientManager().getAllClients();

    return {
      server: status,
      clients: clients.map(client => ({
        id: client.id,
        name: client.name,
        connected: this.browserAgentServer.connectedClients.has(client.id),
        ready: this.browserAgentServer.connectedClients.get(client.id)?.ready || false
      }))
    };
  }

  getClients() {
    const clients = this.browserAgentServer.getClientManager().getAllClients();
    const connectedClients = this.browserAgentServer.connectedClients;

    return clients.map(client => {
      const tabs = this.browserAgentServer.getClientManager().getClientTabs(client.id);

      return {
        id: client.id,
        name: client.name,
        description: client.description,
        tabCount: tabs.length,
        tabs: tabs.map(tab => ({
          tabId: tab.tabId,
          compositeClientId: tab.compositeClientId,
          connected: connectedClients.has(tab.compositeClientId),
          ready: connectedClients.get(tab.compositeClientId)?.ready || false,
          connectedAt: tab.connectedAt,
          remoteAddress: tab.connection?.remoteAddress || 'unknown'
        }))
      };
    });
  }

  getClientTabsById(clientId) {
    if (!clientId) {
      throw new Error('Client ID is required');
    }

    const tabs = this.browserAgentServer.getClientManager().getClientTabs(clientId);
    const connectedClients = this.browserAgentServer.connectedClients;
    const client = this.browserAgentServer.getClientManager().getClient(clientId);

    if (!client) {
      throw new Error(`Client '${clientId}' not found`);
    }

    return {
      baseClientId: clientId,
      clientName: client.name,
      tabCount: tabs.length,
      tabs: tabs.map(tab => ({
        tabId: tab.tabId,
        compositeClientId: tab.compositeClientId,
        connected: connectedClients.has(tab.compositeClientId),
        ready: connectedClients.get(tab.compositeClientId)?.ready || false,
        connectedAt: tab.connectedAt,
        remoteAddress: tab.connection?.remoteAddress || 'unknown'
      }))
    };
  }

  async openTab(payload) {
    const { clientId, url = 'about:blank', background = false } = payload;

    if (!clientId) {
      throw new Error('Client ID is required');
    }

    // Since we use direct CDP, we don't need the client to be connected
    // Just extract the baseClientId (first part before colon if composite, or the whole ID)
    const baseClientId = clientId.split(':')[0];

    const result = await this.browserAgentServer.openTab(baseClientId, { url, background });

    return {
      clientId: baseClientId,
      tabId: result.tabId,
      compositeClientId: result.compositeClientId,
      url: result.url || url,
      status: 'opened'
    };
  }

  async closeTab(payload) {
    const { clientId, tabId } = payload;

    if (!clientId) {
      throw new Error('Client ID is required');
    }

    if (!tabId) {
      throw new Error('Tab ID is required');
    }

    // Since we use direct CDP, we don't need the client to be connected
    // Just extract the baseClientId
    const baseClientId = clientId.split(':')[0];

    const result = await this.browserAgentServer.closeTab(baseClientId, { tabId });

    return {
      clientId: baseClientId,
      tabId,
      status: 'closed',
      success: result.success !== false
    };
  }

  async getPageContent(payload) {
    const { clientId, tabId, format = 'html', includeIframes = false } = payload;

    if (!clientId) {
      throw new Error('Client ID is required');
    }

    if (!tabId) {
      throw new Error('Tab ID is required');
    }

    if (!['html', 'text'].includes(format)) {
      throw new Error('Format must be either "html" or "text"');
    }

    const baseClientId = clientId.split(':')[0];

    logger.info('Getting page content', { baseClientId, tabId, format, includeIframes });

    // Call appropriate method based on format
    const result = format === 'html'
      ? await this.browserAgentServer.getPageHTML(tabId, { includeIframes })
      : await this.browserAgentServer.getPageText(tabId, { includeIframes });

    const response = {
      clientId: baseClientId,
      tabId: result.tabId,
      content: result.content,
      format: result.format,
      length: result.length,
      timestamp: Date.now()
    };

    // Include frame count if iframes were captured
    if (result.frameCount !== undefined) {
      response.frameCount = result.frameCount;
    }

    return response;
  }

  async getDOMSnapshot(payload) {
    const {
      clientId,
      tabId,
      computedStyles = [],
      includeDOMRects = true,
      includePaintOrder = false
    } = payload;

    if (!clientId) {
      throw new Error('Client ID is required');
    }

    if (!tabId) {
      throw new Error('Tab ID is required');
    }

    const baseClientId = clientId.split(':')[0];

    logger.info('Capturing DOM snapshot', {
      baseClientId,
      tabId,
      computedStyleCount: computedStyles.length,
      includeDOMRects,
      includePaintOrder
    });

    // Call the captureDOMSnapshot method from BrowserAgentServer
    const result = await this.browserAgentServer.captureDOMSnapshot(tabId, {
      computedStyles,
      includeDOMRects,
      includePaintOrder
    });

    return {
      clientId: baseClientId,
      tabId: result.tabId,
      snapshot: result.snapshot,  // Contains { documents, strings }
      format: 'dom-snapshot',
      timestamp: Date.now()
    };
  }

  async getScreenshot(payload) {
    const { clientId, tabId, fullPage = false } = payload;

    if (!clientId) {
      throw new Error('Client ID is required');
    }

    if (!tabId) {
      throw new Error('Tab ID is required');
    }

    const baseClientId = clientId.split(':')[0];

    logger.info('Capturing screenshot', { baseClientId, tabId, fullPage });

    const result = await this.browserAgentServer.captureScreenshot(tabId, { fullPage });

    return {
      clientId: baseClientId,
      tabId: result.tabId,
      imageData: result.imageData,
      format: result.format,
      fullPage: result.fullPage,
      timestamp: Date.now()
    };
  }

  async executeJavaScript(payload) {
    const { clientId, tabId, expression, returnByValue = true, awaitPromise = false } = payload;

    if (!clientId) {
      throw new Error('Client ID is required');
    }

    if (!tabId) {
      throw new Error('Tab ID is required');
    }

    if (!expression) {
      throw new Error('JavaScript expression is required');
    }

    const baseClientId = clientId.split(':')[0];

    logger.info('Executing JavaScript', { baseClientId, tabId, expression: expression.substring(0, 100) });

    const result = await this.browserAgentServer.evaluateJavaScript(tabId, expression, { returnByValue, awaitPromise });

    return {
      clientId: baseClientId,
      tabId: result.tabId,
      result: result.result,
      exceptionDetails: result.exceptionDetails,
      timestamp: Date.now()
    };
  }

  /**
   * Execute a tool directly without LLM orchestration
   * POST /v1/tools/execute
   *
   * Request format:
   * {
   *   "clientId": "xxx",
   *   "tabId": "yyy",
   *   "tool": "perform_action",
   *   "args": { "method": "click", "nodeId": 123 },
   *   "timeout": 30000
   * }
   */
  async executeToolDirect(payload) {
    const { clientId, tabId, tool, args, timeout = 30000 } = payload;

    if (!clientId) {
      throw new Error('Client ID is required');
    }

    if (!tabId) {
      throw new Error('Tab ID is required');
    }

    if (!tool) {
      throw new Error('Tool name is required');
    }

    const baseClientId = clientId.split(':')[0];
    const compositeClientId = `${baseClientId}:${tabId}`;

    logger.info('Executing tool directly', {
      baseClientId,
      tabId,
      tool,
      timeout,
      hasArgs: !!args
    });

    // Find the connection for this tab
    const connection = this.browserAgentServer.connectedClients.get(compositeClientId);

    if (!connection) {
      throw new Error(`No DevTools connection found for tab ${tabId}. Ensure the tab's DevTools is connected.`);
    }

    if (!connection.ready) {
      throw new Error(`DevTools connection for tab ${tabId} is not ready.`);
    }

    // Execute the tool via RPC
    const result = await this.browserAgentServer.executeToolDirect(
      connection,
      tool,
      args,
      timeout
    );

    // RPC response wraps the tool result in a 'result' field
    // e.g., { result: { success: true, output: {...} } }
    const toolResult = result?.result ?? result;

    return {
      clientId: baseClientId,
      tabId,
      tool,
      success: toolResult?.success ?? false,
      output: toolResult?.output,
      executionTime: toolResult?.executionTime,
      error: toolResult?.error,
      timestamp: Date.now()
    };
  }

  /**
   * Get list of available tools
   * GET /v1/tools
   *
   * Note: This returns a static list of known tools since the tool registry
   * lives in the DevTools frontend. For dynamic tool discovery, use the
   * DevTools connection.
   */
  getAvailableTools() {
    // Static list of commonly available tools
    // The actual registry is in the DevTools frontend (TypeScript)
    const tools = [
      {
        name: 'perform_action',
        description: 'Execute DOM actions on elements (click, type, hover, etc.)',
        schema: {
          type: 'object',
          properties: {
            method: {
              type: 'string',
              enum: ['click', 'fill', 'type', 'press', 'hover', 'scrollIntoView', 'selectOption', 'check', 'uncheck', 'setChecked'],
              description: 'Action method to execute'
            },
            nodeId: {
              type: ['number', 'string'],
              description: 'Accessibility tree node ID'
            },
            args: {
              type: 'array',
              description: 'Arguments for the action (e.g., text to type)'
            },
            reasoning: {
              type: 'string',
              description: 'Reasoning for the action'
            }
          },
          required: ['method', 'nodeId']
        }
      },
      {
        name: 'navigate_url',
        description: 'Navigate to a URL',
        schema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'URL to navigate to'
            },
            reasoning: {
              type: 'string',
              description: 'Reasoning for navigation'
            }
          },
          required: ['url']
        }
      },
      {
        name: 'scroll_page',
        description: 'Scroll the page',
        schema: {
          type: 'object',
          properties: {
            direction: {
              type: 'string',
              enum: ['up', 'down', 'left', 'right'],
              description: 'Scroll direction'
            },
            amount: {
              type: 'number',
              description: 'Scroll amount in pixels'
            },
            pages: {
              type: 'number',
              description: 'Number of pages to scroll'
            }
          }
        }
      },
      {
        name: 'get_accessibility_tree',
        description: 'Get the accessibility tree for the current page',
        schema: {
          type: 'object',
          properties: {
            maxDepth: {
              type: 'number',
              description: 'Maximum depth to traverse'
            }
          }
        }
      },
      {
        name: 'take_screenshot',
        description: 'Capture a screenshot of the page',
        schema: {
          type: 'object',
          properties: {
            fullPage: {
              type: 'boolean',
              description: 'Capture full page or viewport only'
            }
          }
        }
      },
      {
        name: 'get_page_html',
        description: 'Get the HTML content of the page',
        schema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'execute_javascript',
        description: 'Execute JavaScript in the page context',
        schema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'JavaScript code to execute'
            }
          },
          required: ['code']
        }
      }
    ];

    return {
      tools,
      count: tools.length,
      timestamp: Date.now()
    };
  }

  // ============================================
  // Convenience Action Endpoints
  // ============================================

  /**
   * Click on an element
   * POST /actions/click
   *
   * Request: { clientId, tabId, nodeId, timeout? }
   */
  async handleActionClick(payload) {
    const { clientId, tabId, nodeId, timeout = 30000 } = payload;

    if (!clientId) {
      throw new Error('Client ID is required');
    }

    if (!tabId) {
      throw new Error('Tab ID is required');
    }

    if (nodeId === undefined || nodeId === null) {
      throw new Error('Node ID is required for click action');
    }

    // Ensure DevTools connection is ready before executing
    const baseClientId = clientId.split(':')[0];
    const compositeClientId = `${baseClientId}:${tabId}`;
    await this.waitForClientConnection(compositeClientId);

    return this.executeToolDirect({
      clientId,
      tabId,
      tool: 'perform_action',
      args: {
        method: 'click',
        nodeId,
        reasoning: 'Click action via API'
      },
      timeout
    });
  }

  /**
   * Type text into an element
   * POST /actions/type
   *
   * Request: { clientId, tabId, nodeId, text, timeout? }
   */
  async handleActionType(payload) {
    const { clientId, tabId, nodeId, text, timeout = 30000 } = payload;

    if (!clientId) {
      throw new Error('Client ID is required');
    }

    if (!tabId) {
      throw new Error('Tab ID is required');
    }

    if (nodeId === undefined || nodeId === null) {
      throw new Error('Node ID is required for type action');
    }

    if (!text) {
      throw new Error('Text is required for type action');
    }

    // Ensure DevTools connection is ready before executing
    const baseClientId = clientId.split(':')[0];
    const compositeClientId = `${baseClientId}:${tabId}`;
    await this.waitForClientConnection(compositeClientId);

    return this.executeToolDirect({
      clientId,
      tabId,
      tool: 'perform_action',
      args: {
        method: 'fill',
        nodeId,
        args: [text],
        reasoning: 'Type action via API'
      },
      timeout
    });
  }

  /**
   * Scroll the page
   * POST /actions/scroll
   *
   * Request: { clientId, tabId, direction?, amount?, pages?, timeout? }
   */
  async handleActionScroll(payload) {
    const { clientId, tabId, direction = 'down', amount, pages, timeout = 30000 } = payload;

    if (!clientId) {
      throw new Error('Client ID is required');
    }

    if (!tabId) {
      throw new Error('Tab ID is required');
    }

    // Ensure DevTools connection is ready before executing
    const baseClientId = clientId.split(':')[0];
    const compositeClientId = `${baseClientId}:${tabId}`;
    await this.waitForClientConnection(compositeClientId);

    return this.executeToolDirect({
      clientId,
      tabId,
      tool: 'scroll_page',
      args: {
        direction,
        amount,
        pages
      },
      timeout
    });
  }

  /**
   * Navigate to a URL
   * POST /actions/navigate
   *
   * Request: { clientId, tabId, url, timeout? }
   */
  async handleActionNavigate(payload) {
    const { clientId, tabId, url, timeout = 30000 } = payload;

    if (!clientId) {
      throw new Error('Client ID is required');
    }

    if (!tabId) {
      throw new Error('Tab ID is required');
    }

    if (!url) {
      throw new Error('URL is required for navigate action');
    }

    // Ensure DevTools connection is ready before executing
    const baseClientId = clientId.split(':')[0];
    const compositeClientId = `${baseClientId}:${tabId}`;
    await this.waitForClientConnection(compositeClientId);

    return this.executeToolDirect({
      clientId,
      tabId,
      tool: 'navigate_url',
      args: {
        url,
        reasoning: 'Navigate action via API'
      },
      timeout
    });
  }

  /**
   * Hover over an element
   * POST /actions/hover
   *
   * Request: { clientId, tabId, nodeId, timeout? }
   */
  async handleActionHover(payload) {
    const { clientId, tabId, nodeId, timeout = 30000 } = payload;

    if (!clientId) {
      throw new Error('Client ID is required');
    }

    if (!tabId) {
      throw new Error('Tab ID is required');
    }

    if (nodeId === undefined || nodeId === null) {
      throw new Error('Node ID is required for hover action');
    }

    // Ensure DevTools connection is ready before executing
    const baseClientId = clientId.split(':')[0];
    const compositeClientId = `${baseClientId}:${tabId}`;
    await this.waitForClientConnection(compositeClientId);

    return this.executeToolDirect({
      clientId,
      tabId,
      tool: 'perform_action',
      args: {
        method: 'hover',
        nodeId,
        reasoning: 'Hover action via API'
      },
      timeout
    });
  }

  /**
   * Get the accessibility tree for a page
   * GET/POST /page/accessibility-tree
   *
   * Request: { clientId, tabId, maxDepth? }
   */
  async getAccessibilityTree(payload) {
    const { clientId, tabId, maxDepth } = payload;

    if (!clientId) {
      throw new Error('Client ID is required');
    }

    if (!tabId) {
      throw new Error('Tab ID is required');
    }

    // Ensure DevTools connection is ready before executing
    const baseClientId = clientId.split(':')[0];
    const compositeClientId = `${baseClientId}:${tabId}`;
    await this.waitForClientConnection(compositeClientId);

    return this.executeToolDirect({
      clientId,
      tabId,
      tool: 'get_page_content',
      args: {
        maxDepth
      },
      timeout: 30000
    });
  }

  /**
   * Handle OpenAI Responses API compatible requests with nested model format
   */
  async handleResponsesRequest(requestBody) {
    try {
      // Validate required input field - support both string and conversation array formats
      if (!requestBody.input) {
        throw new Error('Missing required "input" field.');
      }

      const inputType = typeof requestBody.input;
      const isString = inputType === 'string';
      const isArray = Array.isArray(requestBody.input);

      if (!isString && !isArray) {
        throw new Error('Invalid "input" field. Expected a string or array of messages.');
      }

      // If array, validate structure (OpenAI Responses API conversation format)
      if (isArray) {
        const MAX_MESSAGES = 100;
        const MAX_MESSAGE_LENGTH = 10000; // 10KB per message

        if (requestBody.input.length === 0) {
          throw new Error('Invalid "input" field. Message array cannot be empty.');
        }

        if (requestBody.input.length > MAX_MESSAGES) {
          throw new Error(`Conversation too long. Maximum ${MAX_MESSAGES} messages allowed.`);
        }

        // Validate each message has required fields
        for (let i = 0; i < requestBody.input.length; i++) {
          const msg = requestBody.input[i];

          if (!msg.role || !msg.content) {
            throw new Error(`Invalid message at index ${i}. Each message must have "role" and "content" fields.`);
          }

          if (!['system', 'user', 'assistant'].includes(msg.role)) {
            throw new Error(`Invalid message role at index ${i}: "${msg.role}". Must be "system", "user", or "assistant".`);
          }

          if (typeof msg.content !== 'string') {
            throw new Error(`Invalid message content at index ${i}. Content must be a string.`);
          }

          if (msg.content.length > MAX_MESSAGE_LENGTH) {
            throw new Error(`Message content too long at index ${i}. Maximum ${MAX_MESSAGE_LENGTH} characters per message.`);
          }
        }

        // Ensure there's at least one user message
        const hasUserMessage = requestBody.input.some(msg => msg.role === 'user');
        if (!hasUserMessage) {
          throw new Error('Invalid "input" field. Conversation must contain at least one user message.');
        }
      }

      // Handle nested model configuration directly
      const nestedModelConfig = this.processNestedModelConfig(requestBody);

      // Extract optional URL and wait timeout
      const targetUrl = requestBody.url || 'about:blank';
      const waitTimeout = requestBody.wait_timeout || 5000;

      const redact = (mk) => ({
        ...mk,
        api_key: mk?.api_key ? `${String(mk.api_key).slice(0, 4)}...` : undefined,
        endpoint: mk?.endpoint ? '[configured]' : undefined
      });

      // Format input for logging
      const logInput = isArray
        ? `[conversation with ${requestBody.input.length} messages]`
        : requestBody.input.length > 100
          ? requestBody.input.substring(0, 100) + '...'
          : requestBody.input;

      logger.info('Processing responses request:', {
        input: logInput,
        inputType: isArray ? 'conversation' : 'string',
        messageCount: isArray ? requestBody.input.length : undefined,
        url: targetUrl,
        wait_timeout: targetUrl !== 'about:blank' ? waitTimeout : 0,
        modelConfig: {
          main_model: redact(nestedModelConfig.main_model),
          mini_model: redact(nestedModelConfig.mini_model),
          nano_model: redact(nestedModelConfig.nano_model),
        }
      });

      // Find a client with existing tabs (not the dummy client)
      const baseClientId = this.findClientWithTabs();

      // Open a new tab for this request at the specified URL
      logger.info('Opening new tab for responses request', { baseClientId, url: targetUrl });
      const tabResult = await this.browserAgentServer.openTab(baseClientId, {
        url: targetUrl,
        background: false
      });

      logger.info('Tab opened successfully', {
        tabId: tabResult.tabId,
        compositeClientId: tabResult.compositeClientId
      });

      // Wait for the new tab's DevTools to connect
      const tabClient = await this.waitForClientConnection(tabResult.compositeClientId);

      // Wait for page to load if a custom URL was provided
      if (targetUrl !== 'about:blank') {
        logger.info('Waiting for page to load', { waitTimeout });
        await new Promise(resolve => setTimeout(resolve, waitTimeout));
      }

      // Extract tracing metadata for Langfuse integration
      const tracingMetadata = requestBody.metadata || {};

      // Create a dynamic request for this request
      const request = this.createDynamicRequestNested(requestBody.input, nestedModelConfig, tracingMetadata);

      // Execute the request on the new tab's DevTools client
      logger.info('Executing request on new tab', {
        compositeClientId: tabResult.compositeClientId,
        requestId: request.id
      });

      const result = await this.browserAgentServer.executeRequest(tabClient, request);

      // Debug: log the result structure
      logger.debug('executeRequest result:', result);

      // Extract the response text from the result
      const responseText = this.extractResponseText(result);

      // Format in OpenAI-compatible Responses API format with tab metadata
      return this.formatResponse(responseText, tabResult.compositeClientId.split(':')[0], tabResult.tabId);

    } catch (error) {
      logger.error('Error handling responses request:', error);
      throw error;
    }
  }

  /**
   * Process nested model configuration from request body
   * @param {Object} requestBody - Request body containing optional model configuration
   * @returns {import('./types/model-config').ModelConfig} Nested model configuration
   */
  processNestedModelConfig(requestBody) {
    const defaults = this.configDefaults?.model || {};
    // Default LiteLLM endpoint from environment variable
    const defaultLiteLLMEndpoint = process.env.LITELLM_ENDPOINT;

    // If nested format is provided, use it directly with fallbacks
    if (requestBody.model) {
      // Helper to get endpoint with fallback chain:
      // 1. Try tier-specific endpoint (e.g., main_model.endpoint)
      // 2. Fall back to top-level endpoint (e.g., model.endpoint)
      // 3. Fall back to LITELLM_ENDPOINT env var (for litellm provider)
      // @param {Object} resolvedConfig - Config after extractModelTierConfig (has defaults applied)
      // @param {Object} rawTierConfig - Original tier config from request (may be undefined)
      const getEndpoint = (resolvedConfig, rawTierConfig) => {
        const explicitEndpoint = rawTierConfig?.endpoint || requestBody.model.endpoint;
        if (explicitEndpoint) return explicitEndpoint;
        // Use env var default for litellm provider (check resolved config for provider)
        if (resolvedConfig?.provider === 'litellm') return defaultLiteLLMEndpoint;
        return undefined;
      };

      // Extract tier configs first so getEndpoint can use resolved provider
      const mainConfig = this.extractModelTierConfig('main', requestBody.model.main_model, defaults);
      const miniConfig = this.extractModelTierConfig('mini', requestBody.model.mini_model, defaults);
      const nanoConfig = this.extractModelTierConfig('nano', requestBody.model.nano_model, defaults);

      return {
        main_model: {
          ...mainConfig,
          endpoint: getEndpoint(mainConfig, requestBody.model.main_model)
        },
        mini_model: {
          ...miniConfig,
          endpoint: getEndpoint(miniConfig, requestBody.model.mini_model)
        },
        nano_model: {
          ...nanoConfig,
          endpoint: getEndpoint(nanoConfig, requestBody.model.nano_model)
        }
      };
    }

    // No model config provided, use defaults
    return {
      main_model: this.createDefaultModelConfig('main', defaults),
      mini_model: this.createDefaultModelConfig('mini', defaults),
      nano_model: this.createDefaultModelConfig('nano', defaults)
    };
  }

  /**
   * Extract model tier configuration from request
   * Handles both nested format { provider: "litellm", model: "qwen3:14b", api_key: "..." }
   * and flat format "qwen3:14b"
   * @param {'main' | 'mini' | 'nano'} tier - Model tier
   * @param {any} tierConfig - Configuration from request (can be object or string)
   * @param {Object} defaults - Default configuration from config.yaml
   * @returns {Object} Extracted configuration (without endpoint)
   */
  extractModelTierConfig(tier, tierConfig, defaults) {
    // If not provided, use defaults
    if (!tierConfig) {
      return this.createDefaultModelConfig(tier, defaults);
    }

    // If it's an object with provider/model/api_key, extract those fields
    if (typeof tierConfig === 'object' && tierConfig.provider) {
      // Get API key with fallback for litellm provider
      let apiKey = tierConfig.api_key;
      if (!apiKey && tierConfig.provider === 'litellm') {
        apiKey = process.env.LITELLM_API_KEY;
      }
      return {
        provider: tierConfig.provider,
        model: tierConfig.model,
        api_key: apiKey
        // endpoint will be added by caller
      };
    }

    // If it's just a string (model name), use default provider
    if (typeof tierConfig === 'string') {
      return {
        provider: defaults.provider || 'openai',
        model: tierConfig,
        api_key: process.env.OPENAI_API_KEY
      };
    }

    // Fallback to defaults
    return this.createDefaultModelConfig(tier, defaults);
  }

  /**
   * Create default model configuration for a tier
   * @param {'main' | 'mini' | 'nano'} tier - Model tier
   * @param {Object} defaults - Default configuration from config.yaml
   * @returns {import('./types/model-config').ModelTierConfig} Model tier configuration
   */
  createDefaultModelConfig(tier, defaults) {
    const defaultModels = {
      main: defaults.main_model || 'gpt-4',
      mini: defaults.mini_model || 'gpt-4-mini',
      nano: defaults.nano_model || 'gpt-3.5-turbo'
    };

    const provider = defaults.provider || 'openai';

    return {
      provider: provider,
      model: defaultModels[tier],
      api_key: process.env.OPENAI_API_KEY,
      // Add endpoint for litellm provider with env var fallback
      endpoint: defaults.endpoint || (provider === 'litellm' ? process.env.LITELLM_ENDPOINT : undefined)
    };
  }


  /**
   * Find a connected and ready client
   */
  findReadyClient() {
    for (const [clientId, connection] of this.browserAgentServer.connectedClients) {
      if (connection.ready) {
        return connection;
      }
    }
    return null;
  }

  /**
   * Find a client that has existing tabs (not the dummy client)
   * @returns {string} Base client ID
   */
  findClientWithTabs() {
    const clients = this.browserAgentServer.getClientManager().getAllClients();

    // First, try to find a client with existing tabs
    for (const client of clients) {
      const tabs = this.browserAgentServer.getClientManager().getClientTabs(client.id);
      if (tabs.length > 0) {
        logger.info('Found client with tabs', { clientId: client.id, tabCount: tabs.length });
        return client.id;
      }
    }

    // If no client with tabs, use the first available client (even with 0 tabs)
    if (clients.length > 0) {
      logger.info('No clients with tabs found, using first available client', { clientId: clients[0].id });
      return clients[0].id;
    }

    throw new Error('No clients found. Please ensure at least one DevTools client is registered.');
  }

  /**
   * Wait for a client connection to be established and ready
   * @param {string} compositeClientId - Composite client ID (baseClientId:tabId)
   * @param {number} maxWaitMs - Maximum time to wait in milliseconds
   * @returns {Promise<Object>} Connection object
   */
  async waitForClientConnection(compositeClientId, maxWaitMs = 10000) {
    const startTime = Date.now();
    const pollInterval = 500; // Check every 500ms

    logger.info('Waiting for client connection', { compositeClientId, maxWaitMs });

    while (Date.now() - startTime < maxWaitMs) {
      const connection = this.browserAgentServer.connectedClients.get(compositeClientId);

      if (connection && connection.ready) {
        logger.info('Client connection established and ready', {
          compositeClientId,
          waitedMs: Date.now() - startTime
        });
        return connection;
      }

      // Wait before next check
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Timeout waiting for client connection: ${compositeClientId}. Tab may not have connected to eval-server.`);
  }

  /**
   * Create a dynamic evaluation object with nested model configuration
   * @param {string|Array<{role: string, content: string}>} input - Input message (string) or conversation array (OpenAI Responses API format)
   * @param {import('./types/model-config').ModelConfig} nestedModelConfig - Model configuration
   * @param {Object} tracingMetadata - Optional tracing metadata for Langfuse integration
   * @returns {import('./types/model-config').EvaluationRequest} Evaluation request object
   */
  createDynamicRequestNested(input, nestedModelConfig, tracingMetadata = {}) {
    const requestId = `api-req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // Determine input format and structure accordingly
    // The browser-side EvaluationAgent.ts already handles both formats:
    // - String format: { message: "text" }
    // - Conversation array format: [{ role: "user", content: "text" }, ...]
    let evaluationInput;

    if (typeof input === 'string') {
      // Legacy format: simple string input
      evaluationInput = { message: input };
    } else if (Array.isArray(input)) {
      // New format: conversation array (OpenAI Responses API format)
      // Pass directly - EvaluationAgent.ts already has full support via:
      // - convertMessagesToChatMessages() method (lines 868-888)
      // - extractSystemPrompt() method (lines 893-898)
      // - executeChatEvaluation() method (lines 900-1150)
      evaluationInput = input;
    } else {
      // Fallback for unexpected format (shouldn't reach here due to validation)
      evaluationInput = { message: String(input) };
    }

    return {
      id: requestId,
      name: 'API Request',
      description: 'Dynamic request created from API request',
      enabled: true,
      tool: 'chat',
      timeout: 7200000, // 2 hours (increased for slow custom API)
      input: evaluationInput,
      model: nestedModelConfig,
      validation: {
        type: 'none' // No validation needed for API responses
      },
      metadata: {
        tags: ['api', 'dynamic'],
        priority: 'high',
        source: 'api'
      },
      // Tracing metadata for Langfuse integration
      // Contains session_id, trace_id, eval_id, etc. from eval framework
      tracing: tracingMetadata
    };
  }


  /**
   * Extract response text from evaluation result
   */
  extractResponseText(result) {
    if (!result) {
      return 'No response received from evaluation';
    }

    // Handle different result formats
    if (typeof result === 'string') {
      return result;
    }

    // Check for nested evaluation result structure
    if (result.output && result.output.response) {
      return result.output.response;
    }

    if (result.output && result.output.text) {
      return result.output.text;
    }

    if (result.output && result.output.answer) {
      return result.output.answer;
    }

    // Check top-level properties
    if (result.response) {
      return result.response;
    }

    if (result.text) {
      return result.text;
    }

    if (result.answer) {
      return result.answer;
    }

    // If result is an object, try to extract meaningful content
    if (typeof result === 'object') {
      return JSON.stringify(result, null, 2);
    }

    return 'Unable to extract response text from evaluation result';
  }

  /**
   * Format response in OpenAI-compatible Responses API format
   */
  formatResponse(responseText, clientId = null, tabId = null) {
    const messageId = `msg_${uuidv4().replace(/-/g, '')}`;

    // Debug: log the parameters
    logger.debug('formatResponse called with:', { clientId, tabId, hasClientId: !!clientId, hasTabId: !!tabId });

    const response = [
      {
        id: messageId,
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: responseText,
            annotations: []
          }
        ]
      }
    ];

    // Add metadata if clientId and tabId are provided
    if (clientId && tabId) {
      response[0].metadata = {
        clientId,
        tabId
      };
      logger.debug('Metadata added to response:', response[0].metadata);
    } else {
      logger.debug('Metadata NOT added - clientId or tabId missing');
    }

    return response;
  }

  sendResponse(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }

  sendError(res, statusCode, message) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }

  stop() {
    if (this.server) {
      this.server.close();
      logger.info('API server stopped');
    }
  }
}

export { APIServer };
