// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { WebSocketServer } from 'ws';

import { ClientManager } from '../client-manager.js';
import { CONFIG, validateConfig } from '../config.js';
import logger, { logConnection, logRequest } from '../logger.js';
import { RpcClient } from '../rpc-client.js';

/**
 * BrowserAgentServer - OpenAI-compatible HTTP API wrapper for Browser Operator
 *
 * Example usage:
 * ```js
 * const server = new BrowserAgentServer({
 *   authKey: 'your-secret-key',
 *   host: '127.0.0.1',
 *   port: 8080
 * });
 *
 * server.onConnect(client => {
 *   console.log(`Client connected: ${client.id}`);
 *
 *   client.execute({
 *     id: "test_request",
 *     name: "Bloomberg Task",
 *     description: "Navigate to Bloomberg and summarize latest news",
 *     input: {
 *       objective: "Navigate to Bloomberg, summarize and return sentiment of the latest news."
 *     }
 *   }).then(response => {
 *     console.log('Request response:', response);
 *   });
 * });
 *
 * server.start();
 * ```
 */
export class BrowserAgentServer extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // Apply configuration options
    this.config = {
      host: options.host || CONFIG.server.host,
      port: options.port || CONFIG.server.port,
      authKey: options.authKey || null,
      clientsDir: options.clientsDir || './clients',
      ...options
    };

    // Internal state
    this.connectedClients = new Map();
    this.clientManager = new ClientManager(this.config.clientsDir);
    this.judge = null; // Judge is optional - can be set later
    this.wss = null;
    this.isRunning = false;
    
    // Bind methods
    this.handleConnection = this.handleConnection.bind(this);
  }

  /**
   * Start the browser agent server
   */
  async start() {
    if (this.isRunning) {
      throw new Error('Server is already running');
    }

    // Validate configuration - only require LLM if judge is configured
    const configErrors = validateConfig(!!this.judge);
    if (configErrors.length > 0) {
      throw new Error(`Configuration errors: ${configErrors.join(', ')}`);
    }

    // Create WebSocket server
    this.wss = new WebSocketServer({
      port: this.config.port,
      host: this.config.host
    });

    this.wss.on('connection', this.handleConnection);
    this.wss.on('error', error => {
      logger.error('WebSocket server error', { error: error.message });
      this.emit('error', error);
    });

    this.isRunning = true;
    logger.info(`Browser agent server started on ws://${this.config.host}:${this.config.port}`);
    this.emit('started', { host: this.config.host, port: this.config.port });

    return this;
  }

  /**
   * Stop the browser agent server
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Close all client connections
    for (const [clientId, connection] of this.connectedClients) {
      connection.rpcClient.cleanup();
      if (connection.ws.readyState === connection.ws.OPEN) {
        connection.ws.close();
      }
    }
    this.connectedClients.clear();

    this.isRunning = false;
    logger.info('Browser agent server stopped');
    this.emit('stopped');
  }

  /**
   * Register a callback for when clients connect
   * @param {Function} callback - Called with a ClientProxy instance
   */
  onConnect(callback) {
    this.on('clientConnected', callback);
    return this;
  }

  /**
   * Register a callback for when clients disconnect
   * @param {Function} callback - Called with client info
   */
  onDisconnect(callback) {
    this.on('clientDisconnected', callback);
    return this;
  }

  /**
   * Set the judge for request validation (optional)
   * @param {Judge} judge - Judge instance for request validation
   */
  setJudge(judge) {
    // If server is already running, validate LLM config when setting judge
    if (this.isRunning) {
      const configErrors = validateConfig(true);
      if (configErrors.length > 0) {
        throw new Error(`Cannot set judge: ${configErrors.join(', ')}`);
      }
    }

    this.judge = judge;
    return this;
  }


  /**
   * Get current server status
   */
  getStatus() {
    const connections = Array.from(this.connectedClients.values());
    const readyClients = connections.filter(client => client.ready).length;
    const uniqueBaseClients = new Set(connections.map(c => c.baseClientId).filter(Boolean)).size;
    
    return {
      isRunning: this.isRunning,
      connectedClients: this.connectedClients.size,
      uniqueBaseClients: uniqueBaseClients,
      totalTabs: this.clientManager.getTotalTabCount(),
      readyClients: readyClients,
      host: this.config.host,
      port: this.config.port
    };
  }

  /**
   * Get the client manager instance
   */
  getClientManager() {
    return this.clientManager;
  }

  /**
   * Handle new WebSocket connections
   */
  handleConnection(ws, request) {
    const connectionId = uuidv4();
    const connection = {
      id: connectionId,
      ws,
      rpcClient: new RpcClient(),
      connectedAt: new Date().toISOString(),
      remoteAddress: request.socket.remoteAddress,
      registered: false,
      clientId: null
    };

    this.connectedClients.set(connectionId, connection);

    logConnection({
      event: 'connected',
      connectionId,
      remoteAddress: connection.remoteAddress,
      totalConnections: this.connectedClients.size
    });

    ws.on('message', message => {
      this.handleMessage(connection, message);
    });

    ws.on('close', () => {
      this.handleDisconnection(connection);
    });

    ws.on('error', error => {
      logger.error('WebSocket connection error', {
        connectionId: connection.id,
        clientId: connection.clientId,
        error: error.message
      });
    });

    // Send welcome message
    this.sendMessage(ws, {
      type: 'welcome',
      serverId: 'server-001',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Handle incoming messages from clients
   */
  async handleMessage(connection, message) {
    try {
      const data = JSON.parse(message);

      // Handle RPC responses
      if (data.jsonrpc === '2.0' && (data.result || data.error) && data.id) {
        if (connection.rpcClient.handleResponse(message)) {
          return;
        }
        logger.debug('RPC response could not be handled', {
          connectionId: connection.id,
          clientId: connection.clientId,
          id: data.id
        });
        return;
      }

      // Handle RPC requests from client to server
      if (data.jsonrpc === '2.0' && data.method && data.id) {
        await this.handleRpcRequest(connection, data);
        return;
      }

      // Handle other message types
      switch (data.type) {
        case 'register':
          await this.handleRegistration(connection, data);
          break;
        case 'ping':
          this.sendMessage(connection.ws, {
            type: 'pong',
            timestamp: new Date().toISOString()
          });
          break;
        case 'ready':
          if (!connection.registered) {
            logger.warn('Received ready signal from unregistered client', {
              connectionId: connection.id
            });
            return;
          }
          connection.ready = true;
          logger.info('Client ready for requests', {
            clientId: connection.clientId
          });
          
          // Create client proxy and emit connection event
          const clientProxy = new ClientProxy(connection, this);
          this.emit('clientConnected', clientProxy);
          break;
        case 'status':
          this.handleStatusUpdate(connection, data);
          break;
        case 'auth_verify':
          this.handleAuthVerification(connection, data);
          break;
        default:
          logger.warn('Unknown message type', {
            connectionId: connection.id,
            clientId: connection.clientId,
            type: data.type
          });
      }
    } catch (error) {
      logger.warn('Failed to parse message', {
        connectionId: connection.id,
        error: error.message
      });
    }
  }

  /**
   * Handle RPC requests from client to server
   */
  async handleRpcRequest(connection, request) {
    try {
      const { method, params, id } = request;

      logger.info('Received RPC request', {
        connectionId: connection.id,
        clientId: connection.clientId,
        method,
        requestId: id
      });

      let result = null;

      switch (method) {
        case 'configure_llm':
          result = await this.handleConfigureLLM(connection, params);
          break;
        default:
          // JSON-RPC: Method not found
          this.sendMessage(connection.ws, {
            jsonrpc: '2.0',
            error: {
              code: -32601,
              message: `Method not found: ${method}`
            },
            id
          });
          return;
      }

      // Send success response
      this.sendMessage(connection.ws, {
        jsonrpc: '2.0',
        result,
        id
      });

    } catch (error) {
      logger.error('RPC request failed', {
        connectionId: connection.id,
        clientId: connection.clientId,
        method: request.method,
        requestId: request.id,
        error: error.message
      });

      // Send error response
      this.sendMessage(connection.ws, {
        jsonrpc: '2.0',
        error: {
          code: -32603, // Internal error
          message: error.message
        },
        id: request.id
      });
    }
  }

  /**
   * Handle configure_llm RPC method
   */
  async handleConfigureLLM(connection, params) {
    if (!connection.registered) {
      throw new Error('Client must be registered before configuring LLM');
    }

    const { provider, apiKey, endpoint, models, partial = false } = params;

    // Validate inputs
    const supportedProviders = ['openai', 'litellm', 'groq', 'openrouter', 'cerebras', 'anthropic', 'google'];
    if (partial) {
      // For partial updates, validate only provided fields
      if (provider && !supportedProviders.includes(provider)) {
        throw new Error(`Unsupported provider: ${provider}. Supported providers: ${supportedProviders.join(', ')}`);
      }
      if (models && models.main === '') {
        throw new Error('Main model cannot be empty');
      }
    } else {
      // For full updates, require provider and main model
      if (!provider || !supportedProviders.includes(provider)) {
        throw new Error(`Unsupported or missing provider: ${provider ?? '(none)'}. Supported providers: ${supportedProviders.join(', ')}`);
      }
      if (!models || !models.main) {
        throw new Error('Main model is required');
      }
    }

    // Store configuration for this client connection
    if (!connection.llmConfig) {
      connection.llmConfig = {};
    }

    // Apply configuration (full or partial update)
    if (partial && connection.llmConfig) {
      // Partial update - merge with existing config
      connection.llmConfig = {
        ...connection.llmConfig,
        provider: provider || connection.llmConfig.provider,
        apiKey: apiKey || connection.llmConfig.apiKey,
        endpoint: endpoint || connection.llmConfig.endpoint,
        models: {
          ...connection.llmConfig.models,
          ...models
        }
      };
    } else {
      // Full update - replace entire config
      connection.llmConfig = {
        provider,
        apiKey: apiKey || CONFIG.providers[provider]?.apiKey,
        endpoint: endpoint || CONFIG.providers[provider]?.endpoint,
        models: {
          main: models.main,
          mini: models.mini || models.main,
          nano: models.nano || models.mini || models.main
        }
      };
    }

    logger.info('LLM configuration updated', {
      clientId: connection.clientId,
      provider: connection.llmConfig.provider,
      models: connection.llmConfig.models,
      hasApiKey: !!connection.llmConfig.apiKey,
      hasEndpoint: !!connection.llmConfig.endpoint
    });

    return {
      status: 'success',
      message: 'LLM configuration updated successfully',
      appliedConfig: {
        provider: connection.llmConfig.provider,
        models: connection.llmConfig.models
      }
    };
  }

  /**
   * Handle client registration
   */
  async handleRegistration(connection, data) {
    try {
      const { clientId, secretKey, capabilities } = data;
      const { baseClientId, tabId, isComposite } = this.clientManager.parseCompositeClientId(clientId);

      logger.info('Registration attempt', {
        clientId,
        baseClientId,
        tabId: tabId || 'default',
        isComposite,
        hasSecretKey: !!secretKey
      });

      // Check if base client exists
      const validation = this.clientManager.validateClient(baseClientId, null, true);
      if (!validation.valid) {
        if (validation.reason === 'Client not found') {
          // Auto-create new client configuration
          try {
            logger.info('Auto-creating new client configuration', { baseClientId, clientId });
            await this.clientManager.createClientWithId(baseClientId, `DevTools Client ${baseClientId.substring(0, 8)}`, 'hello');

            this.sendMessage(connection.ws, {
              type: 'registration_ack',
              clientId,
              status: 'rejected',
              reason: 'New client created. Please reconnect to complete registration.',
              newClient: true
            });
            return;
          } catch (error) {
            this.sendMessage(connection.ws, {
              type: 'registration_ack',
              clientId,
              status: 'rejected',
              reason: `Failed to create client configuration: ${error.message}`
            });
            return;
          }
        } else {
          this.sendMessage(connection.ws, {
            type: 'registration_ack',
            clientId,
            status: 'rejected',
            reason: validation.reason
          });
          return;
        }
      }

      // Get client info
      const client = this.clientManager.getClient(baseClientId);
      if (!client) {
        this.sendMessage(connection.ws, {
          type: 'registration_ack',
          clientId,
          status: 'rejected',
          reason: 'Client configuration not found'
        });
        return;
      }

      // Send server's secret key to client for verification
      this.sendMessage(connection.ws, {
        type: 'registration_ack',
        clientId,
        status: 'auth_required',
        serverSecretKey: client.secretKey || '',
        message: 'Please verify secret key'
      });

      connection.clientId = clientId;
      connection.capabilities = capabilities;
      connection.awaitingAuth = true;

    } catch (error) {
      logger.error('Registration error', { error: error.message });
      this.sendMessage(connection.ws, {
        type: 'registration_ack',
        clientId: data.clientId,
        status: 'rejected',
        reason: error.message
      });
    }
  }

  /**
   * Handle auth verification
   */
  handleAuthVerification(connection, data) {
    if (!connection.awaitingAuth) {
      return;
    }

    const { clientId, verified } = data;

    if (verified) {
      const { baseClientId, tabId, isComposite } = this.clientManager.parseCompositeClientId(clientId);
      
      const result = this.clientManager.registerClient(baseClientId, '', connection.capabilities, true);

      connection.registered = true;
      connection.awaitingAuth = false;
      connection.compositeClientId = clientId;
      connection.baseClientId = baseClientId;
      connection.tabId = tabId;

      // Register tab with client manager
      this.clientManager.registerTab(clientId, connection, {
        remoteAddress: connection.remoteAddress,
        userAgent: connection.userAgent || 'unknown'
      });

      // Move connection to use composite clientId as key
      this.connectedClients.delete(connection.id);
      this.connectedClients.set(clientId, connection);

      this.sendMessage(connection.ws, {
        type: 'registration_ack',
        clientId,
        status: 'accepted',
        message: result.clientName ? `Welcome ${result.clientName}` : 'Client authenticated successfully',
        requestsCount: result.requestsCount,
        tabId: tabId,
        isComposite: isComposite
      });

      logger.info('Client authenticated and registered', { 
        clientId, 
        baseClientId, 
        tabId: tabId || 'default',
        isComposite 
      });
    } else {
      this.sendMessage(connection.ws, {
        type: 'registration_ack',
        clientId,
        status: 'rejected',
        reason: 'Secret key verification failed'
      });

      connection.ws.close(1008, 'Authentication failed');
    }
  }

  /**
   * Handle status updates
   */
  handleStatusUpdate(connection, data) {
    if (!connection.registered) return;

    const { requestId, status, progress, message } = data;

    logger.info('Request status update', {
      clientId: connection.clientId,
      requestId,
      status,
      progress,
      message
    });
  }

  /**
   * Handle client disconnection and cleanup stale tab references
   */
  handleDisconnection(connection) {
    connection.rpcClient.cleanup();

    // Clean up stale tab references
    if (connection.registered && connection.compositeClientId) {
      this.clientManager.unregisterTab(connection.compositeClientId);
      this.connectedClients.delete(connection.compositeClientId);
      
      // Additional cleanup: ensure tab is removed from activeTabs
      const { baseClientId } = this.clientManager.parseCompositeClientId(connection.compositeClientId);
      this.clientManager.cleanupStaleTab(baseClientId, connection.tabId);
    } else if (connection.clientId) {
      this.connectedClients.delete(connection.clientId);
    } else {
      this.connectedClients.delete(connection.id);
    }

    logConnection({
      event: 'disconnected',
      connectionId: connection.id,
      clientId: connection.compositeClientId || connection.clientId,
      baseClientId: connection.baseClientId,
      tabId: connection.tabId,
      totalConnections: this.connectedClients.size
    });

    this.emit('clientDisconnected', {
      clientId: connection.compositeClientId || connection.clientId,
      baseClientId: connection.baseClientId,
      tabId: connection.tabId
    });
  }

  /**
   * Send message to WebSocket client
   */
  sendMessage(ws, data) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify(data));
      } catch (error) {
        logger.error('Failed to send WebSocket message', {
          error: error.message,
          messageType: data.type
        });
      }
    } else {
      logger.warn('Cannot send message, WebSocket not open', { 
        readyState: ws.readyState,
        messageType: data.type
      });
    }
  }

  /**
   * Execute request on a specific client
   */
  async executeRequest(connection, request) {
    const startTime = Date.now();
    const rpcId = `rpc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    try {
      logger.info('Starting request', {
        clientId: connection.clientId,
        requestId: request.id,
        tool: request.tool
      });

      // Prepare model configuration - use client config if available, otherwise request config, otherwise defaults
      let modelConfig = request.model || {};

      if (connection.llmConfig) {
        // New nested format: separate config objects for each model tier
        modelConfig = {
          main_model: {
            provider: connection.llmConfig.provider,
            model: connection.llmConfig.models.main,
            api_key: connection.llmConfig.apiKey,
            endpoint: connection.llmConfig.endpoint
          },
          mini_model: {
            provider: connection.llmConfig.provider,
            model: connection.llmConfig.models.mini,
            api_key: connection.llmConfig.apiKey,
            endpoint: connection.llmConfig.endpoint
          },
          nano_model: {
            provider: connection.llmConfig.provider,
            model: connection.llmConfig.models.nano,
            api_key: connection.llmConfig.apiKey,
            endpoint: connection.llmConfig.endpoint
          },
          // Include any request-specific overrides
          ...modelConfig
        };
      }

      // Prepare RPC request
      const rpcRequest = {
        jsonrpc: '2.0',
        method: 'evaluate',
        params: {
          requestId: request.id,
          name: request.name,
          url: request.target?.url || request.url,
          tool: request.tool,
          input: request.input,
          model: modelConfig,
          timeout: request.timeout || 30000,
          metadata: {
            tags: request.metadata?.tags || [],
            retries: request.settings?.retry_policy?.max_retries || 0
          },
          // Forward tracing metadata for Langfuse session grouping
          tracing: request.tracing || {}
        },
        id: rpcId
      };

      logger.debug('RPC request prepared with tracing:', {
        hasTracing: !!request.tracing,
        tracingKeys: request.tracing ? Object.keys(request.tracing) : [],
        sessionId: request.tracing?.session_id
      });

      // Send RPC request
      const response = await connection.rpcClient.callMethod(
        connection.ws,
        'evaluate',
        rpcRequest.params,
        request.timeout || 45000
      );

      // Log request
      logRequest({
        requestId: request.id,
        clientId: connection.clientId,
        name: request.name,
        tool: request.tool,
        response,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime
      });

      return response;

    } catch (error) {
      logger.error('Request failed', {
        clientId: connection.clientId,
        requestId: request.id,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Get the browser-level CDP WebSocket endpoint
   * @returns {Promise<string>} WebSocket URL
   */
  async getCDPBrowserEndpoint() {
    try {
      const path = '/json/version';
      logger.info('Attempting to connect to CDP', {
        host: CONFIG.cdp.host,
        port: CONFIG.cdp.port,
        path
      });

      // When connecting via host.docker.internal, we need to set Host header to localhost
      // because Chrome only accepts CDP requests with localhost/127.0.0.1 in the Host header
      const headers = {};
      if (CONFIG.cdp.host === 'host.docker.internal') {
        headers['Host'] = `localhost:${CONFIG.cdp.port}`;
        logger.info('Using Host header override for host.docker.internal', headers);
      }

      const options = {
        hostname: CONFIG.cdp.host,
        port: CONFIG.cdp.port,
        path: path,
        method: 'GET',
        headers: headers
      };

      const http = await import('http');

      return new Promise((resolve, reject) => {
        const req = http.default.request(options, (res) => {
          let data = '';

          res.on('data', (chunk) => {
            data += chunk;
          });

          res.on('end', () => {
            try {
              const jsonData = JSON.parse(data);
              let wsUrl = jsonData.webSocketDebuggerUrl;

              // Replace localhost with host.docker.internal when running in Docker
              if (CONFIG.cdp.host === 'host.docker.internal' && wsUrl) {
                wsUrl = wsUrl.replace('ws://localhost:', 'ws://host.docker.internal:');
                wsUrl = wsUrl.replace('ws://127.0.0.1:', 'ws://host.docker.internal:');
                logger.info('Rewrote WebSocket URL for Docker', { original: jsonData.webSocketDebuggerUrl, rewritten: wsUrl });
              }

              resolve(wsUrl);
            } catch (parseError) {
              logger.error('Failed to parse CDP response', { error: parseError.message, data });
              reject(new Error('Failed to connect to Chrome DevTools Protocol'));
            }
          });
        });

        req.on('error', (error) => {
          logger.error('Failed to get CDP browser endpoint', { error: error.message });
          reject(new Error('Failed to connect to Chrome DevTools Protocol'));
        });

        req.end();
      });
    } catch (error) {
      logger.error('Failed to get CDP browser endpoint', { error: error.message });
      throw new Error('Failed to connect to Chrome DevTools Protocol');
    }
  }

  /**
   * Send a CDP command via WebSocket
   * @param {string} method - CDP method name
   * @param {Object} params - CDP method parameters
   * @returns {Promise<Object>} CDP response
   */
  async sendCDPCommand(method, params = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        const { default: WebSocket } = await import('ws');
        const cdpEndpoint = await this.getCDPBrowserEndpoint();
        const ws = new WebSocket(cdpEndpoint);
        // Use a simple counter for CDP message IDs (must be a reasonable integer)
        const id = Math.floor(Math.random() * 1000000);

      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error(`CDP command timeout: ${method}`));
      }, 10000);

      ws.on('open', () => {
        const message = JSON.stringify({
          id,
          method,
          params
        });
        logger.info('CDP WebSocket opened, sending command', { method, params, cdpEndpoint });
        ws.send(message);
      });

      ws.on('message', (data) => {
        try {
          const response = JSON.parse(data.toString());
          logger.info('CDP WebSocket message received', {
            method,
            responseId: response.id,
            expectedId: id,
            hasResult: !!response.result,
            hasError: !!response.error,
            fullResponse: JSON.stringify(response)
          });
          if (response.id === id) {
            clearTimeout(timeout);
            ws.close();

            if (response.error) {
              logger.error('CDP command error', { method, error: response.error });
              reject(new Error(`CDP error: ${response.error.message}`));
            } else {
              logger.info('CDP command success', { method, result: response.result });
              resolve(response.result);
            }
          } else {
            logger.warn('CDP message ID mismatch', {
              method,
              receivedId: response.id,
              expectedId: id,
              responseType: response.method ? 'event' : 'response'
            });
          }
        } catch (error) {
          clearTimeout(timeout);
          ws.close();
          logger.error('CDP message parse error', { error: error.message });
          reject(error);
        }
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        logger.error('CDP WebSocket error', { error: error.message });
        reject(error);
      });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Send a CDP command to a specific target (tab)
   * This requires attaching to the target first, then detaching after
   * @param {string} targetId - Target ID (tab ID)
   * @param {string} method - CDP method name
   * @param {Object} params - CDP method parameters
   * @returns {Promise<Object>} CDP response
   */
  async sendCDPCommandToTarget(targetId, method, params = {}) {
    return new Promise(async (resolve, reject) => {
      try {
        const { default: WebSocket } = await import('ws');
        const cdpEndpoint = await this.getCDPBrowserEndpoint();
        const ws = new WebSocket(cdpEndpoint);

        let sessionId = null;
        const attachId = Math.floor(Math.random() * 1000000);
        const commandId = Math.floor(Math.random() * 1000000);

        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error(`CDP target command timeout: ${method} on ${targetId}`));
        }, 15000);

        ws.on('open', () => {
          // First, attach to the target
          const attachMessage = JSON.stringify({
            id: attachId,
            method: 'Target.attachToTarget',
            params: {
              targetId,
              flatten: true
            }
          });
          logger.info('CDP attaching to target', { targetId, method });
          ws.send(attachMessage);
        });

        ws.on('message', (data) => {
          try {
            const response = JSON.parse(data.toString());

            // Handle attach response
            if (response.id === attachId) {
              if (response.error) {
                clearTimeout(timeout);
                ws.close();
                logger.error('CDP attach error', { targetId, error: response.error });
                reject(new Error(`CDP attach error: ${response.error.message}`));
                return;
              }

              sessionId = response.result.sessionId;
              logger.info('CDP attached to target, sending command', { sessionId, method });

              // Now send the actual command with the session ID
              const commandMessage = JSON.stringify({
                id: commandId,
                method,
                params,
                sessionId
              });
              ws.send(commandMessage);
            }

            // Handle command response
            else if (response.id === commandId) {
              clearTimeout(timeout);

              if (response.error) {
                logger.error('CDP target command error', { method, targetId, error: response.error });
                ws.close();
                reject(new Error(`CDP error: ${response.error.message}`));
              } else {
                logger.info('CDP target command success', { method, targetId });
                ws.close();
                resolve(response.result);
              }
            }
            // Ignore other messages (events, etc.)
          } catch (error) {
            clearTimeout(timeout);
            ws.close();
            logger.error('CDP message parse error', { error: error.message });
            reject(error);
          }
        });

        ws.on('error', (error) => {
          clearTimeout(timeout);
          logger.error('CDP WebSocket error', { error: error.message });
          reject(error);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Open a new tab using CDP directly
   * @param {string} baseClientId - Base client ID (or will be extracted from composite ID)
   * @param {Object} options - Tab options
   * @param {string} options.url - URL to open in the new tab (default: 'about:blank')
   * @param {boolean} options.background - Whether to open in background (default: false)
   * @returns {Promise<Object>} Result with tabId
   */
  async openTab(baseClientId, options = {}) {
    const { url = 'about:blank', background = false } = options;
    // Extract base client ID if composite ID was passed
    const cleanBaseClientId = baseClientId.split(':')[0];

    try {
      logger.info('Opening new tab via CDP', { url, background, baseClientId: cleanBaseClientId });

      // Use CDP Target.createTarget
      const result = await this.sendCDPCommand('Target.createTarget', {
        url,
        newWindow: false,
        background
      });

      const tabId = result.targetId;
      const compositeClientId = `${cleanBaseClientId}:${tabId}`;

      logger.info('Tab opened successfully via CDP', {
        tabId,
        compositeClientId,
        url
      });

      return {
        tabId,
        compositeClientId,
        url
      };
    } catch (error) {
      logger.error('Failed to open tab via CDP', {
        baseClientId,
        url,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Close a tab using CDP directly
   * @param {string} baseClientId - Base client ID (currently not used, kept for API compatibility)
   * @param {Object} options - Close options
   * @param {string} options.tabId - Tab ID to close
   * @returns {Promise<Object>} Result with success status
   */
  async closeTab(baseClientId, options = {}) {
    const { tabId } = options;

    if (!tabId) {
      throw new Error('tabId is required to close a tab');
    }

    try {
      logger.info('Closing tab via CDP', { tabId, baseClientId });

      // Use CDP Target.closeTarget
      const result = await this.sendCDPCommand('Target.closeTarget', {
        targetId: tabId
      });

      logger.info('Tab closed successfully via CDP', {
        tabId,
        success: result.success
      });

      return {
        success: result.success !== false,
        tabId
      };
    } catch (error) {
      logger.error('Failed to close tab via CDP', {
        tabId,
        baseClientId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get page HTML content using CDP
   * @param {string} tabId - Tab ID (target ID)
   * @returns {Promise<Object>} Result with HTML content
   */
  async getPageHTML(tabId, options = {}) {
    const { includeIframes = false } = options;

    try {
      logger.info('Getting page HTML via CDP', { tabId, includeIframes });

      if (!includeIframes) {
        // Original behavior - main frame only
        const result = await this.sendCDPCommandToTarget(tabId, 'Runtime.evaluate', {
          expression: 'document.documentElement.outerHTML',
          returnByValue: true
        });

        const html = result.result.value;

        logger.info('Page HTML retrieved successfully', {
          tabId,
          length: html.length
        });

        return {
          tabId,
          content: html,
          format: 'html',
          length: html.length
        };
      }

      // Enhanced behavior - include all frames
      const frameTree = await this.sendCDPCommandToTarget(tabId, 'Page.getFrameTree', {});
      const allFrameHTML = await this.captureAllFramesHTML(tabId, frameTree.frameTree);

      logger.info('Page HTML with iframes retrieved successfully', {
        tabId,
        length: allFrameHTML.length,
        frameCount: this.countFrames(frameTree.frameTree)
      });

      return {
        tabId,
        content: allFrameHTML,
        format: 'html',
        length: allFrameHTML.length,
        frameCount: this.countFrames(frameTree.frameTree)
      };
    } catch (error) {
      logger.error('Failed to get page HTML via CDP', {
        tabId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Recursively capture HTML from all frames
   * @param {string} tabId Tab ID
   * @param {Object} frameTree Frame tree from Page.getFrameTree
   * @returns {Promise<string>} Combined HTML from all frames
   */
  async captureAllFramesHTML(tabId, frameTree) {
    const frames = [];

    // Helper to recursively collect frames
    const collectFrames = (node) => {
      frames.push(node.frame);
      if (node.childFrames) {
        node.childFrames.forEach(collectFrames);
      }
    };

    collectFrames(frameTree);

    logger.info('Collecting HTML from frames', { tabId, frameCount: frames.length });

    // Capture HTML from each frame
    const htmlParts = [];

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      try {
        // For the main frame (first frame), use Runtime.evaluate without frameId
        // For child frames, we need to create an execution context in that frame

        let result;
        if (i === 0) {
          // Main frame - simple evaluation
          result = await this.sendCDPCommandToTarget(tabId, 'Runtime.evaluate', {
            expression: 'document.documentElement.outerHTML',
            returnByValue: true
          });
        } else {
          // Child frame - need to create isolated world in the frame's context
          // First, create an execution context in this frame
          const contextResult = await this.sendCDPCommandToTarget(tabId, 'Page.createIsolatedWorld', {
            frameId: frame.id,
            grantUniversalAccess: true,
            worldName: 'iframe-capture'
          });

          // Now evaluate in that context
          result = await this.sendCDPCommandToTarget(tabId, 'Runtime.evaluate', {
            expression: 'document.documentElement.outerHTML',
            returnByValue: true,
            contextId: contextResult.executionContextId
          });
        }

        htmlParts.push({
          frameId: frame.id,
          url: frame.url,
          html: result.result.value
        });

        logger.info('Captured frame HTML', {
          tabId,
          frameId: frame.id,
          url: frame.url,
          length: result.result.value.length
        });
      } catch (error) {
        logger.warn('Failed to capture frame HTML', {
          tabId,
          frameId: frame.id,
          url: frame.url,
          error: error.message
        });
      }
    }

    // Combine HTML with frame markers
    if (htmlParts.length === 0) {
      throw new Error('No frames captured');
    }

    let combined = htmlParts[0].html; // Main frame

    for (let i = 1; i < htmlParts.length; i++) {
      combined += `\n\n<!-- FRAME ${i}: ${htmlParts[i].url} -->\n${htmlParts[i].html}`;
    }

    return combined;
  }

  /**
   * Count total frames in frame tree
   * @param {Object} frameTree Frame tree node
   * @returns {number} Total frame count
   */
  countFrames(frameTree) {
    let count = 1; // Current frame
    if (frameTree.childFrames) {
      frameTree.childFrames.forEach(child => {
        count += this.countFrames(child);
      });
    }
    return count;
  }

  /**
   * Get page text content using CDP
   * @param {string} tabId - Tab ID (target ID)
   * @returns {Promise<Object>} Result with text content
   */
  async getPageText(tabId) {
    try {
      logger.info('Getting page text via CDP', { tabId });

      // Use Runtime.evaluate to get document.body.innerText
      const result = await this.sendCDPCommandToTarget(tabId, 'Runtime.evaluate', {
        expression: 'document.body.innerText',
        returnByValue: true
      });

      const text = result.result.value;

      logger.info('Page text retrieved successfully', {
        tabId,
        length: text.length
      });

      return {
        tabId,
        content: text,
        format: 'text',
        length: text.length
      };
    } catch (error) {
      logger.error('Failed to get page text via CDP', {
        tabId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Capture DOM snapshot using CDP DOMSnapshot.captureSnapshot
   * @param {string} tabId - Tab ID (target ID)
   * @param {Object} options - Snapshot options
   * @param {string[]} options.computedStyles - Array of computed style properties to capture (default: [])
   * @param {boolean} options.includeDOMRects - Whether to include bounding boxes (default: true)
   * @param {boolean} options.includePaintOrder - Whether to include paint order (default: false)
   * @returns {Promise<Object>} Result with DOM snapshot data
   */
  async captureDOMSnapshot(tabId, options = {}) {
    const {
      computedStyles = [],
      includeDOMRects = true,
      includePaintOrder = false
    } = options;

    try {
      logger.info('Capturing DOM snapshot via CDP', {
        tabId,
        computedStyleCount: computedStyles.length,
        includeDOMRects,
        includePaintOrder
      });

      // Use DOMSnapshot.captureSnapshot CDP command
      const result = await this.sendCDPCommandToTarget(tabId, 'DOMSnapshot.captureSnapshot', {
        computedStyles,
        includeDOMRects,
        includePaintOrder
      });

      // Validate response structure
      if (!result.documents || !result.strings) {
        throw new Error('Invalid DOMSnapshot response: missing documents or strings array');
      }

      logger.info('DOM snapshot captured successfully', {
        tabId,
        documentCount: result.documents.length,
        stringCount: result.strings.length,
        totalNodes: result.documents.reduce((sum, doc) => sum + (doc.nodes?.nodeType?.length || 0), 0)
      });

      return {
        tabId,
        snapshot: result  // Contains documents[] and strings[]
      };
    } catch (error) {
      logger.error('Failed to capture DOM snapshot via CDP', {
        tabId,
        error: error.message,
        stack: error.stack
      });

      // Check if DOMSnapshot domain is available
      if (error.message && error.message.includes('was not found')) {
        throw new Error('DOMSnapshot domain not available. Requires Chrome 74+ with CDP enabled.');
      }

      throw error;
    }
  }

  /**
   * Capture page screenshot using CDP
   * @param {string} tabId - Tab ID (target ID)
   * @param {Object} options - Screenshot options
   * @param {boolean} options.fullPage - Whether to capture full page (default: false)
   * @returns {Promise<Object>} Result with screenshot data
   */
  async captureScreenshot(tabId, options = {}) {
    const { fullPage = false } = options;

    try {
      logger.info('Capturing screenshot via CDP', { tabId, fullPage });

      // Use Page.captureScreenshot
      const result = await this.sendCDPCommandToTarget(tabId, 'Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: fullPage
      });

      const imageData = `data:image/png;base64,${result.data}`;

      logger.info('Screenshot captured successfully', {
        tabId,
        dataLength: result.data.length
      });

      return {
        tabId,
        imageData,
        format: 'png',
        fullPage
      };
    } catch (error) {
      logger.error('Failed to capture screenshot via CDP', {
        tabId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Execute a tool directly on a connected DevTools client
   * This bypasses LLM orchestration and calls the tool directly
   * @param {Object} connection - DevTools WebSocket connection
   * @param {string} tool - Tool name (e.g., 'perform_action', 'navigate_url')
   * @param {Object} args - Tool-specific arguments
   * @param {number} timeout - Execution timeout in milliseconds
   * @returns {Promise<Object>} Tool execution result
   */
  async executeToolDirect(connection, tool, args, timeout = 30000) {
    const rpcId = `tool-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    logger.info('Executing tool directly', {
      clientId: connection.clientId,
      tool,
      timeout
    });

    try {
      // Prepare RPC request for execute_tool method
      const response = await connection.rpcClient.callMethod(
        connection.ws,
        'execute_tool',
        {
          tool,
          args,
          timeout
        },
        timeout + 5000 // Add buffer for network overhead
      );

      logger.info('Tool execution completed', {
        clientId: connection.clientId,
        tool,
        success: response?.result?.success
      });

      return response;

    } catch (error) {
      logger.error('Tool execution failed', {
        clientId: connection.clientId,
        tool,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Execute JavaScript in a browser tab
   * @param {string} tabId - Tab ID (target ID)
   * @param {string} expression - JavaScript expression to execute
   * @param {Object} options - Execution options
   * @param {boolean} options.returnByValue - Whether to return by value (default: true)
   * @param {boolean} options.awaitPromise - Whether to await promises (default: false)
   * @returns {Promise<Object>} Result with execution result
   */
  async evaluateJavaScript(tabId, expression, options = {}) {
    const { returnByValue = true, awaitPromise = false } = options;

    try {
      logger.info('Executing JavaScript via CDP', { tabId, expressionLength: expression.length });

      // Use Runtime.evaluate to execute JavaScript
      const result = await this.sendCDPCommandToTarget(tabId, 'Runtime.evaluate', {
        expression,
        returnByValue,
        awaitPromise
      });

      if (result.exceptionDetails) {
        logger.warn('JavaScript execution threw exception', {
          tabId,
          exception: result.exceptionDetails
        });
      } else {
        logger.info('JavaScript executed successfully', {
          tabId,
          resultType: result.result?.type
        });
      }

      // Extract value from CDP RemoteObject
      // CDP returns RemoteObject with structure: {type: 'string', value: 'foo'}
      // For undefined/null, CDP returns: {type: 'undefined'} or {type: 'null', value: null}
      // We need to check if 'value' property exists, not if it's undefined
      let extractedResult;
      if (result.result) {
        if ('value' in result.result) {
          // RemoteObject has a value field - extract it
          extractedResult = result.result.value;
        } else if (result.result.type === 'undefined') {
          // Special case: undefined has no value field
          extractedResult = undefined;
        } else {
          // For objects/functions without returnByValue, return the whole RemoteObject
          extractedResult = result.result;
        }
      } else {
        extractedResult = result.result;
      }

      return {
        tabId,
        result: extractedResult,
        exceptionDetails: result.exceptionDetails
      };
    } catch (error) {
      logger.error('Failed to execute JavaScript via CDP', {
        tabId,
        error: error.message
      });
      throw error;
    }
  }

}

/**
 * ClientProxy - Provides a convenient interface for interacting with connected clients
 */
class ClientProxy {
  constructor(connection, server) {
    this.connection = connection;
    this.server = server;
    this.id = connection.compositeClientId || connection.clientId;
    this.tabId = connection.tabId;
    this.baseClientId = connection.baseClientId;
  }

  /**
   * Execute a request on this client
   */
  async execute(request) {
    // Ensure request has required fields
    const fullRequest = {
      id: request.id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      name: request.name || 'Dynamic Request',
      description: request.description || 'Programmatically created request',
      enabled: true,
      tool: request.tool || 'chat',
      timeout: request.timeout || 45000,
      input: request.input || {},
      model: request.model || {},
      validation: request.validation || { type: 'none' },
      metadata: request.metadata || { tags: ['api', 'dynamic'] },
      ...request
    };

    return this.server.executeRequest(this.connection, fullRequest);
  }

  /**
   * Alias for backward compatibility
   * @deprecated Use execute() instead
   */
  async evaluate(request) {
    return this.execute(request);
  }

  /**
   * Get client information
   */
  getInfo() {
    return {
      id: this.id,
      tabId: this.tabId,
      baseClientId: this.baseClientId,
      connectedAt: this.connection.connectedAt,
      remoteAddress: this.connection.remoteAddress,
      capabilities: this.connection.capabilities
    };
  }

  /**
   * Send a custom message to the client
   */
  sendMessage(data) {
    this.server.sendMessage(this.connection.ws, data);
  }
}