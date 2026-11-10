// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../core/Logger.js';
import { AgentRunnerEventBus, type AgentRunnerProgressEvent } from '../agent_framework/AgentRunnerEventBus.js';

// Detect if we're in a Node.js environment (eval runner, tests)
const isNodeEnvironment = typeof window === 'undefined' || typeof document === 'undefined';

// Lazy-loaded browser-only dependencies
let Common: typeof import('../../../core/common/common.js') | null = null;
let SDK: typeof import('../../../core/sdk/sdk.js') | null = null;
let browserDepsLoaded = false;

async function ensureBrowserDeps(): Promise<boolean> {
  if (isNodeEnvironment) return false;
  if (!browserDepsLoaded) {
    browserDepsLoaded = true;
    try {
      const [commonModule, sdkModule] = await Promise.all([
        import('../../../core/common/common.js'),
        import('../../../core/sdk/sdk.js'),
      ]);
      Common = commonModule;
      SDK = sdkModule;
    } catch { return false; }
  }
  return SDK !== null && Common !== null;
}

const logger = createLogger('VisualIndicatorTool');

/**
 * Format tool name from snake_case to Title Case
 * Example: "scroll_to_selector" -> "Scroll To Selector"
 */
function formatToolName(toolName: string): string {
  return toolName
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Visual indicator manager that shows real-time feedback for AI agent actions
 * in the inspected page. Displays:
 * 1. Page glow effect (animated border around the page)
 * 2. Thinking overlay (bottom toast showing current action and reasoning)
 */
export class VisualIndicatorManager {
  private static instance: VisualIndicatorManager | null = null;
  private eventBus: AgentRunnerEventBus;
  private agentService: any | null = null; // AgentService reference for checking running state
  private isActive = false;
  private currentSessionId: string | null = null;
  private currentAgentName: string | null = null;
  private activeSessions = new Set<string>();
  private currentToolInfo = new Map<string, { toolName: string, reasoning: string }>();
  private needsNavigationListenerSetup = false;

  private constructor() {
    this.eventBus = AgentRunnerEventBus.getInstance();
  }

  static getInstance(): VisualIndicatorManager {
    if (!this.instance) {
      this.instance = new VisualIndicatorManager();
    }
    return this.instance;
  }

  /**
   * Initialize the visual indicator system with AgentService reference
   */
  initialize(agentService: any): void {
    this.agentService = agentService;
    logger.info('Visual indicator system initialized with AgentService');
    this.setupEventListeners();
    this.setupNavigationListener();
  }

  /**
   * Setup event listeners for agent progress events
   */
  private setupEventListeners(): void {
    logger.info('Setting up event listeners for visual indicators');
    this.eventBus.addEventListener('agent-progress', this.handleProgressEvent.bind(this));
  }

  /**
   * Setup listener for page navigation events to re-inject indicators
   */
  private async setupNavigationListener(): Promise<void> {
    if (!(await ensureBrowserDeps()) || !SDK) {
      logger.warn('[VisualIndicator] Browser deps not available for navigation listener');
      this.needsNavigationListenerSetup = true;
      return;
    }
    const target = SDK.TargetManager.TargetManager.instance().primaryPageTarget();
    if (!target) {
      logger.warn('[VisualIndicator] No primary page target available for navigation listener');
      this.needsNavigationListenerSetup = true;
      return;
    }

    const resourceTreeModel = target.model(SDK.ResourceTreeModel.ResourceTreeModel);
    if (!resourceTreeModel) {
      logger.warn('[VisualIndicator] ResourceTreeModel not available for navigation listener');
      this.needsNavigationListenerSetup = true;
      return;
    }

    logger.info('[VisualIndicator] Setting up navigation listener successfully');
    resourceTreeModel.addEventListener(
      SDK.ResourceTreeModel.Events.FrameNavigated,
      this.handleFrameNavigated.bind(this)
    );
    this.needsNavigationListenerSetup = false;
  }

  /**
   * Handle frame navigation events - re-inject indicators if active
   */
  private async handleFrameNavigated(event: any): Promise<void> {
    const frame = event.data;

    // Only handle main frame navigations (ignore iframes)
    if (!frame.isMainFrame()) {
      return;
    }

    // Only re-inject if indicators are currently active
    if (!this.isActive) {
      return;
    }

    logger.info('[VisualIndicator] Main frame navigated, re-injecting indicators');

    // Get current agent name (from stored state or default)
    const agentName = this.currentAgentName || 'AI Agent';

    // Re-inject indicators into the new page
    await this.injectIndicatorsIntoPage(agentName);

    // Restore current tool info if available
    if (this.currentSessionId) {
      const toolInfo = this.currentToolInfo.get(this.currentSessionId);
      if (toolInfo) {
        logger.info('[VisualIndicator] Restoring tool info after navigation:', toolInfo);
        // Create a synthetic progress event to update the overlay
        const syntheticEvent: AgentRunnerProgressEvent = {
          type: 'tool_started',
          sessionId: this.currentSessionId,
          agentName,
          timestamp: new Date(),
          data: {
            toolCall: {
              type: 'tool_call',
              content: {
                type: 'tool_call',
                toolName: toolInfo.toolName.toLowerCase().replace(/ /g, '_'),
                toolArgs: {},
                toolCallId: 'restored',
                reasoning: toolInfo.reasoning
              }
            }
          }
        };
        await this.updateThinkingOverlay(syntheticEvent);
      }
    }
  }

  /**
   * Handle agent progress events and update visual indicators
   */
  private async handleProgressEvent(event: any): Promise<void> {
    const progressEvent = event.data as AgentRunnerProgressEvent;

    logger.info('[VisualIndicator] Progress event received:', {
      type: progressEvent.type,
      sessionId: progressEvent.sessionId,
      agentName: progressEvent.agentName,
      activeSessions: Array.from(this.activeSessions),
      isActive: this.isActive,
      currentSessionId: this.currentSessionId,
      hasData: !!progressEvent.data
    });

    switch (progressEvent.type) {
      case 'session_started':
        this.activeSessions.add(progressEvent.sessionId);
        await this.showIndicators(progressEvent);
        break;
      case 'tool_started':
        await this.updateThinkingOverlay(progressEvent);
        break;
      case 'tool_completed':
        await this.updateThinkingOverlay(progressEvent);
        break;
      case 'session_updated':
        await this.updateThinkingOverlay(progressEvent);
        break;
      case 'session_completed':
        await this.onSessionCompleted(progressEvent.sessionId);
        break;
    }
  }

  /**
   * Check if any agent is currently running (source of truth from AgentService)
   */
  private hasAnyRunningAgent(): boolean {
    if (!this.agentService) {
      logger.warn('[VisualIndicator] No AgentService - cannot check running state');
      return false;
    }

    const activeSessions = this.agentService.getActiveAgentSessions();
    const hasRunning = activeSessions.some((session: any) => session.status === 'running');

    logger.info('[VisualIndicator] Running agent check:', {
      totalSessions: activeSessions.length,
      hasRunning,
      sessionStates: activeSessions.map((s: any) => ({ id: s.sessionId, status: s.status }))
    });

    return hasRunning;
  }

  /**
   * Notify that a session has completed (call from AgentService)
   */
  async onSessionCompleted(sessionId: string): Promise<void> {
    logger.info('[VisualIndicator] Session completed:', sessionId);
    this.activeSessions.delete(sessionId);

    // Clean up stored tool info for this session
    this.currentToolInfo.delete(sessionId);

    // Check if any agent is still running (source of truth from AgentService)
    if (!this.hasAnyRunningAgent()) {
      logger.info('[VisualIndicator] No agents running - hiding indicators');
      await this.hideIndicators();
    } else {
      logger.info('[VisualIndicator] Other agents still running - keeping indicators visible');
    }
  }

  /**
   * Show visual indicators (glow + overlay)
   */
  private async showIndicators(event: AgentRunnerProgressEvent): Promise<void> {
    logger.info('[VisualIndicator] Showing indicators for session:', event.sessionId);
    this.isActive = true;
    this.currentSessionId = event.sessionId;
    this.currentAgentName = event.agentName;

    // Retry navigation listener setup if it failed during initialization
    if (this.needsNavigationListenerSetup) {
      logger.info('[VisualIndicator] Retrying navigation listener setup');
      this.setupNavigationListener();
    }

    await this.injectIndicatorsIntoPage(event.agentName);
  }

  /**
   * Inject visual indicators (glow + overlay) into the page DOM
   * This method can be called both initially and after page navigations
   * Includes retry logic for when document.body is not yet available
   */
  private async injectIndicatorsIntoPage(agentName: string, retryCount = 0): Promise<void> {
    const maxRetries = 5;
    const retryDelay = Math.min(100 * Math.pow(2, retryCount), 2000); // 100ms, 200ms, 400ms, 800ms, 1600ms, 2000ms

    if (!(await ensureBrowserDeps()) || !SDK) {
      logger.warn('[VisualIndicator] Browser deps not available');
      return;
    }
    const target = SDK.TargetManager.TargetManager.instance().primaryPageTarget();
    if (!target) {
      logger.warn('[VisualIndicator] No primary page target available');
      return;
    }

    try {
      const runtimeAgent = target.runtimeAgent();

      const result = await runtimeAgent.invoke_evaluate({
        expression: `
          (() => {
            console.log('[VisualIndicator] Injecting visual indicators into page', {
              hasBody: !!document.body,
              readyState: document.readyState,
              timestamp: Date.now()
            });

            // Check if DOM is ready (document.body exists)
            if (!document.body) {
              console.log('[VisualIndicator] document.body not ready yet');
              return { success: false, needsRetry: true, message: 'document.body not available' };
            }

            // Prevent duplicate injection
            if (document.getElementById('devtools-agent-glow-style')) {
              console.log('[VisualIndicator] Already injected, skipping');
              return { success: true, message: 'Already injected' };
            }

            // Inject glow CSS
            const glowStyle = document.createElement('style');
            glowStyle.id = 'devtools-agent-glow-style';
            glowStyle.textContent = \`
              @keyframes devtools-agent-glow {
                0%, 100% {
                  box-shadow: 0 0 20px 2px rgba(0, 164, 254, 0.4),
                              inset 0 0 20px 2px rgba(0, 164, 254, 0.2);
                }
                50% {
                  box-shadow: 0 0 40px 4px rgba(0, 164, 254, 0.7),
                              inset 0 0 40px 4px rgba(0, 164, 254, 0.3);
                }
              }

              html.devtools-agent-active {
                min-height: 100vh;
                animation: devtools-agent-glow 2s ease-in-out infinite;
              }

              #devtools-agent-indicator {
                position: fixed;
                bottom: 24px;
                left: 50%;
                transform: translateX(-50%) translateY(10px);
                background: linear-gradient(135deg, rgba(0, 20, 40, 0.75) 0%, rgba(0, 10, 30, 0.70) 100%);
                backdrop-filter: blur(16px) saturate(180%);
                -webkit-backdrop-filter: blur(16px) saturate(180%);
                color: white;
                padding: 12px 20px 14px 20px;
                border-radius: 10px;
                border: 1px solid rgba(0, 164, 254, 0.25);
                border-top: 2px solid rgba(0, 164, 254, 0.6);
                box-shadow:
                  0 8px 32px rgba(0, 0, 0, 0.4),
                  0 2px 8px rgba(0, 0, 0, 0.2),
                  inset 0 1px 0 rgba(255, 255, 255, 0.1);
                z-index: 2147483647;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
                font-size: 12px;
                max-width: 520px;
                min-width: 280px;
                opacity: 0;
                transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                pointer-events: auto;
                cursor: default;
              }

              #devtools-agent-indicator.visible {
                opacity: 1;
                transform: translateX(-50%) translateY(0);
              }

              #devtools-agent-indicator.visible:hover {
                opacity: 0.15;
                background: linear-gradient(135deg, rgba(0, 20, 40, 0.15) 0%, rgba(0, 10, 30, 0.1) 100%);
                backdrop-filter: blur(4px) saturate(120%);
                -webkit-backdrop-filter: blur(4px) saturate(120%);
                transition: all 0.2s ease-out;
              }

              .devtools-agent-name {
                display: flex;
                align-items: center;
                font-weight: 600;
                font-size: 14px;
                color: #4fc3f7;
                margin-bottom: 6px;
                padding-bottom: 6px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
                letter-spacing: 0.3px;
              }

              .devtools-agent-action {
                font-weight: 500;
                font-size: 12px;
                margin-bottom: 4px;
                color: rgba(255, 255, 255, 0.95);
                text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
                line-height: 1.5;
              }

              .devtools-agent-reasoning {
                font-size: 10px;
                color: rgba(255, 255, 255, 0.7);
                font-style: italic;
                margin-top: 4px;
                line-height: 1.5;
                padding-left: 2px;
              }

              .devtools-agent-reasoning:empty {
                display: none;
              }

              .devtools-agent-spinner {
                display: inline-block;
                width: 13px;
                height: 13px;
                border: 2.5px solid rgba(79, 195, 247, 0.25);
                border-top-color: #4fc3f7;
                border-radius: 50%;
                animation: devtools-agent-spin 0.8s linear infinite;
                margin-right: 10px;
                flex-shrink: 0;
              }

              @keyframes devtools-agent-spin {
                to { transform: rotate(360deg); }
              }
            \`;
            document.head.appendChild(glowStyle);

            // Add glow class to html
            document.documentElement.classList.add('devtools-agent-active');

            // Create thinking overlay
            const overlay = document.createElement('div');
            overlay.id = 'devtools-agent-indicator';
            overlay.innerHTML = \`
              <div class="devtools-agent-name">
                <span class="devtools-agent-spinner"></span>
                <span class="devtools-agent-title"></span>
              </div>
              <div class="devtools-agent-action">Starting...</div>
              <div class="devtools-agent-reasoning"></div>
            \`;

            // Set agent name via textContent (safe from XSS)
            const titleEl = overlay.querySelector('.devtools-agent-title');
            if (titleEl) {
              const formattedAgentName = ${JSON.stringify(agentName || 'AI Agent')}.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
              titleEl.textContent = formattedAgentName;
            }

            document.body.appendChild(overlay);

            // Fade in
            requestAnimationFrame(() => {
              overlay.classList.add('visible');
              console.log('[VisualIndicator] Overlay visible, glow active');
            });

            return { success: true, message: 'Visual indicators shown' };
          })()
        `,
        returnByValue: true
      });

      // Check if we need to retry
      const resultValue = result.result?.value;
      if (resultValue?.needsRetry && retryCount < maxRetries) {
        logger.info(`[VisualIndicator] DOM not ready, scheduling retry ${retryCount + 1}/${maxRetries} in ${retryDelay}ms`);
        setTimeout(() => {
          void this.injectIndicatorsIntoPage(agentName, retryCount + 1);
        }, retryDelay);
        return;
      }

      if (resultValue?.success) {
        logger.info('[VisualIndicator] Visual indicators injected successfully:', resultValue.message);
      } else if (retryCount >= maxRetries) {
        logger.warn('[VisualIndicator] Failed to inject indicators after max retries');
      }
    } catch (error) {
      logger.error('Error injecting visual indicators:', error);

      // Retry on exception if we haven't exceeded max retries
      if (retryCount < maxRetries) {
        logger.info(`[VisualIndicator] Error occurred, scheduling retry ${retryCount + 1}/${maxRetries} in ${retryDelay}ms`);
        setTimeout(() => {
          void this.injectIndicatorsIntoPage(agentName, retryCount + 1);
        }, retryDelay);
      }
    }
  }

  /**
   * Update the thinking overlay with current action
   */
  private async updateThinkingOverlay(event: AgentRunnerProgressEvent): Promise<void> {
    if (!this.isActive) {
      return;
    }

    if (!(await ensureBrowserDeps()) || !SDK) {
      return;
    }
    const target = SDK.TargetManager.TargetManager.instance().primaryPageTarget();
    if (!target) {
      return;
    }

    try {
      const runtimeAgent = target.runtimeAgent();

      // Extract agent name from event and update current state
      const rawAgentName = event.agentName || this.currentAgentName || 'AI Agent';
      const agentName = formatToolName(rawAgentName);

      if (event.agentName) {
        this.currentAgentName = event.agentName;
      }

      // Extract action and reasoning from event
      let action = 'Working...';
      let reasoning = '';

      if (event.type === 'tool_started' && event.data?.toolCall) {
        const toolCall = event.data.toolCall;
        const toolName = toolCall.content?.toolName || 'tool';
        const formattedToolName = formatToolName(toolName);

        // Extract reasoning from multiple sources (matching UI pattern)
        // Priority: 1) LLM reasoning (O-models), 2) toolArgs.reasoning (most common), 3) fallback aliases
        const toolArgs = toolCall.content?.toolArgs || {};
        const reasonFromArgs = toolArgs?.reasoning ?? toolArgs?.reason;
        let toolReasoning = toolCall.content?.reasoning ||
                           (reasonFromArgs !== undefined ? String(reasonFromArgs) : '') ||
                           '';

        // Fallback: if the provider didn't return reasoning, try the latest session reasoning message
        if (!toolReasoning && event.data?.session?.messages && Array.isArray(event.data.session.messages)) {
          try {
            const messages = event.data.session.messages as Array<any>;
            for (let i = messages.length - 1; i >= 0; i--) {
              const m = messages[i];
              if (m?.type === 'reasoning' && m?.content?.text) {
                toolReasoning = String(m.content.text || '').trim();
                if (toolReasoning) break;
              }
            }
          } catch {
            // Ignore fallback errors silently
          }
        }

        // Log detailed tool call info for debugging
        logger.info('[VisualIndicator] Tool started:', {
          toolName,
          formattedToolName,
          reasoning: toolReasoning,
          toolArgs: toolCall.content?.toolArgs,
          fullData: event.data
        });

        // Store tool info for later use during completion
        this.currentToolInfo.set(event.sessionId, {
          toolName: formattedToolName,
          reasoning: toolReasoning
        });

        action = `Running: ${formattedToolName}`;
        reasoning = toolReasoning;

      } else if (event.type === 'tool_completed' && event.data?.toolResult) {
        const toolResult = event.data.toolResult;
        const storedInfo = this.currentToolInfo.get(event.sessionId);

        // Log detailed tool result info for debugging
        logger.info('[VisualIndicator] Tool completed:', {
          success: toolResult.content?.success,
          error: toolResult.content?.error,
          storedInfo,
          fullData: event.data
        });

        // Get tool name from stored info or result
        const formattedToolName = storedInfo?.toolName ||
                                  (toolResult.content?.toolName ? formatToolName(toolResult.content.toolName) : 'Tool');

        // Show completion status with tool name
        if (toolResult.content?.success) {
          action = `${formattedToolName} completed ✓`;
        } else if (toolResult.content?.error) {
          action = `${formattedToolName} failed ✗`;
          // Don't show technical errors as reasoning - they're already in the action text
        } else {
          action = `${formattedToolName} completed`;
        }

        // Keep showing original reasoning if no error, otherwise show error
        if (toolResult.content?.success) {
          if (storedInfo?.reasoning) {
            reasoning = storedInfo.reasoning;
          } else if (event.data?.session?.messages && Array.isArray(event.data.session.messages)) {
            // Fallback in case we missed the tool_started or it had no reasoning
            try {
              const messages = event.data.session.messages as Array<any>;
              for (let i = messages.length - 1; i >= 0; i--) {
                const m = messages[i];
                if (m?.type === 'reasoning' && m?.content?.text) {
                  const fallback = String(m.content.text || '').trim();
                  if (fallback) { reasoning = fallback; break; }
                }
              }
            } catch {
              // Ignore fallback errors silently
            }
          }
        }
      }

      // Log what we're displaying
      logger.info('[VisualIndicator] Updating overlay:', { agentName, action, reasoning });

      await runtimeAgent.invoke_evaluate({
        expression: `
          (() => {
            const overlay = document.getElementById('devtools-agent-indicator');
            if (!overlay) {
              return { success: false, message: 'Overlay not found' };
            }

            // Update agent name in header
            const titleEl = overlay.querySelector('.devtools-agent-title');
            if (titleEl) {
              titleEl.textContent = ${JSON.stringify(agentName)};
            }

            // Update action and reasoning
            const actionEl = overlay.querySelector('.devtools-agent-action');
            const reasoningEl = overlay.querySelector('.devtools-agent-reasoning');

            if (actionEl) {
              actionEl.textContent = ${JSON.stringify(action)};
            }

            if (reasoningEl) {
              reasoningEl.textContent = ${JSON.stringify(reasoning)};
              // Hide reasoning div when empty
              reasoningEl.style.display = ${JSON.stringify(reasoning ? 'block' : 'none')};
            }

            return { success: true, message: 'Overlay updated' };
          })()
        `,
        returnByValue: true
      });

      logger.info('Thinking overlay updated successfully');
    } catch (error) {
      logger.error('Error updating thinking overlay:', error);
    }
  }

  /**
   * Hide visual indicators (glow + overlay)
   */
  async hideIndicators(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;
    this.currentSessionId = null;

    if (!(await ensureBrowserDeps()) || !SDK) {
      return;
    }
    const target = SDK.TargetManager.TargetManager.instance().primaryPageTarget();
    if (!target) {
      return;
    }

    try {
      const runtimeAgent = target.runtimeAgent();

      await runtimeAgent.invoke_evaluate({
        expression: `
          (() => {
            // Remove glow class
            document.documentElement.classList.remove('devtools-agent-active');

            // Fade out overlay
            const overlay = document.getElementById('devtools-agent-indicator');
            if (overlay) {
              overlay.classList.remove('visible');
              setTimeout(() => {
                overlay.remove();
              }, 300);
            }

            // Remove glow style
            const glowStyle = document.getElementById('devtools-agent-glow-style');
            if (glowStyle) {
              glowStyle.remove();
            }

            return { success: true, message: 'Visual indicators hidden' };
          })()
        `,
        returnByValue: true
      });

      logger.info('Visual indicators hidden successfully');
    } catch (error) {
      logger.error('Error hiding visual indicators:', error);
    }
  }

  /**
   * Check if indicators are currently active
   */
  isIndicatorActive(): boolean {
    return this.isActive;
  }
}
