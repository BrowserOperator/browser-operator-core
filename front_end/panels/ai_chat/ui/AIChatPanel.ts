// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type * as Common from '../../../core/common/common.js';
import * as Host from '../../../core/host/host.js';
import * as i18n from '../../../core/i18n/i18n.js';
import * as SDK from '../../../core/sdk/sdk.js';
import * as UI from '../../../ui/legacy/legacy.js';
import {AgentService, Events as AgentEvents} from '../core/AgentService.js';
import { LLMClient } from '../LLM/LLMClient.js';
import {
  LLMConfigurationManager,
  type ModelOption,
  DEFAULT_PROVIDER_MODELS,
  DEFAULT_OPENAI_MODELS,
  MODEL_PLACEHOLDERS as CONFIG_MODEL_PLACEHOLDERS,
} from '../core/LLMConfigurationManager.js';
import { LLMProviderRegistry } from '../LLM/LLMProviderRegistry.js';
import { createLogger } from '../core/Logger.js';
import { CustomProviderManager } from '../core/CustomProviderManager.js';
import type { LLMProvider } from '../LLM/LLMTypes.js';
import type { ProviderType } from './settings/types.js';
import { isEvaluationEnabled, getEvaluationConfig } from '../common/EvaluationConfig.js';
import { EvaluationAgent } from '../evaluation/remote/EvaluationAgent.js';
import { BUILD_CONFIG } from '../core/BuildConfig.js';
import { OnboardingDialog, createSetupRequiredBanner } from './OnboardingDialog.js';
// Import of LiveAgentSessionComponent is not required here; the element is
// registered by ChatView where it is used.

const logger = createLogger('AIChatPanel');

/**
 * Storage monitoring utility for debugging credential issues
 */
class StorageMonitor {
  private static instance: StorageMonitor | null = null;
  private originalSetItem: typeof localStorage.setItem;
  private originalRemoveItem: typeof localStorage.removeItem;
  
  private constructor() {
    this.originalSetItem = localStorage.setItem.bind(localStorage);
    this.originalRemoveItem = localStorage.removeItem.bind(localStorage);
    this.setupStorageMonitoring();
  }
  
  static getInstance(): StorageMonitor {
    if (!StorageMonitor.instance) {
      StorageMonitor.instance = new StorageMonitor();
    }
    return StorageMonitor.instance;
  }
  
  private setupStorageMonitoring(): void {
    // Monitor setItem operations
    localStorage.setItem = (key: string, value: string) => {
      if (key.includes('openrouter') || key.includes('ai_chat')) {
        logger.debug(`=== LOCALSTORAGE SET ===`);
        logger.debug(`Key: ${key}`);
        logger.debug(`Value exists: ${!!value}`);
        logger.debug(`Value length: ${value?.length || 0}`);
        logger.debug(`Value preview: ${value?.substring(0, 50) + (value?.length > 50 ? '...' : '') || 'null'}`);
        logger.debug(`Timestamp: ${new Date().toISOString()}`);
      }
      return this.originalSetItem(key, value);
    };
    
    // Monitor removeItem operations
localStorage.removeItem = (key: string) => {
      if (key.includes('openrouter') || key.includes('ai_chat')) {
        logger.debug(`=== LOCALSTORAGE REMOVE ===`);
        logger.debug(`Key: ${key}`);
        logger.debug(`Timestamp: ${new Date().toISOString()}`);
      }
      return this.originalRemoveItem(key);
    };
  }
  
  restore(): void {
    localStorage.setItem = this.originalSetItem;
    localStorage.removeItem = this.originalRemoveItem;
  }
}

import chatViewStyles from './chatView.css.js';
import { ChatView } from './ChatView.js';
import { type ChatMessage, ChatMessageEntity, type ImageInputData, type ModelChatMessage, State as ChatViewState } from '../models/ChatTypes.js';
import { HelpDialog } from './HelpDialog.js';
import { SettingsDialog } from './SettingsDialog.js';
import { EvaluationDialog } from './EvaluationDialog.js';
import { MODEL_PLACEHOLDERS } from '../core/Constants.js';
import * as Snackbars from '../../../ui/components/snackbars/snackbars.js';
// MCP integration
import { MCPRegistry } from '../mcp/MCPRegistry.js';
import { getMCPConfig } from '../mcp/MCPConfig.js';
import { onMCPConfigChange } from '../mcp/MCPConfig.js';
import { MCPConnectorsCatalogDialog } from './mcp/MCPConnectorsCatalogDialog.js';
// Conversation history
import { ConversationHistoryList } from './ConversationHistoryList.js';
// Agent Studio
import { AgentStudioView } from './AgentStudioView.js';


// Re-export ModelOption type for backward compatibility
export type { ModelOption };
// Re-export DEFAULT_PROVIDER_MODELS for backward compatibility
export { DEFAULT_PROVIDER_MODELS };

// Model selector localStorage keys (kept for local usage)
const MODEL_SELECTION_KEY = 'ai_chat_model_selection';
const MINI_MODEL_STORAGE_KEY = 'ai_chat_mini_model';
const NANO_MODEL_STORAGE_KEY = 'ai_chat_nano_model';
// Provider selection key
const PROVIDER_SELECTION_KEY = 'ai_chat_provider';
// LiteLLM configuration keys
const LITELLM_ENDPOINT_KEY = 'ai_chat_litellm_endpoint';
const LITELLM_API_KEY_STORAGE_KEY = 'ai_chat_litellm_api_key';

// Local MODEL_OPTIONS reference that syncs with LLMConfigurationManager
// This maintains backward compatibility while delegating to the centralized manager
let MODEL_OPTIONS: ModelOption[] = [...DEFAULT_OPENAI_MODELS];

// Helper to get MODEL_OPTIONS from LLMConfigurationManager
function getModelOptions(): ModelOption[] {
  return LLMConfigurationManager.getInstance().getModelOptionsForCurrentProvider();
}

// Helper to get all model options across all providers
function getAllModelOptions(): ModelOption[] {
  return LLMConfigurationManager.getInstance().getAllModelOptions();
}

// Sync local MODEL_OPTIONS with LLMConfigurationManager
function syncModelOptions(): void {
  MODEL_OPTIONS = LLMConfigurationManager.getInstance().getModelOptionsForCurrentProvider();
}

const UIStrings = {
  /**
   *@description Text for the AI welcome message
   */
  welcomeMessage: 'Hello! I\'m your AI assistant. How can I help you today?',
  /**
   *@description AI chat UI text creating a new chat.
   */
  newChat: 'New chat',
  /**
   *@description AI chat UI tooltip text for the help button.
   */
  help: 'Help',
  /**
   *@description AI chat UI tooltip text for the MCP connectors catalog button.
   */
  mcpConnectors: 'MCP Connectors',
  /**
   *@description AI chat UI tooltip text for the settings button (gear icon).
   */
  settings: 'Settings',
  /**
   *@description Announcement text for screen readers when a new chat is created.
   */
  newChatCreated: 'New chat created',
  /**
   *@description AI chat UI text creating selecting a history entry.
   */
  history: 'History',
  /**
   * @description Default text shown in the chat input
   */
  inputPlaceholder: 'Ask a question...',
  /**
   * @description Placeholder when OpenAI API key is missing
   */
  missingOpenAIKey: 'Please add your OpenAI API key in Settings',
  /**
   * @description Placeholder when LiteLLM endpoint is missing
   */
  missingLiteLLMEndpoint: 'Please configure LiteLLM endpoint in Settings',
  /**
   * @description Generic placeholder when provider credentials are missing
   */
  missingProviderCredentials: 'Provider credentials required. Please configure in Settings',
  /**
   * @description Run evaluation tests
   */
  runEvaluationTests: 'Run Evaluation Tests',
  /**
   * @description Bookmark current page
   */
  bookmarkPage: 'Bookmark Page',
} as const;

const str_ = i18n.i18n.registerUIStrings('panels/ai_chat/ui/AIChatPanel.ts', UIStrings);
const i18nString = i18n.i18n.getLocalizedString.bind(undefined, str_);

let aiChatPanelInstance: AIChatPanel|null = null;

// For testing purposes - allows resetting the singleton instance
export function resetAIChatPanelInstanceForTesting(): void {
  aiChatPanelInstance = null;
}

export class AIChatPanel extends UI.Panel.Panel {
  static instance(): AIChatPanel {
    if (!aiChatPanelInstance) {
      aiChatPanelInstance = new AIChatPanel();
    }
    return aiChatPanelInstance;
  }

  static getMiniModel(): string {
    const configManager = LLMConfigurationManager.getInstance();
    const miniModel = configManager.getMiniModel();

    // Fallback to main model if mini model not set
    return miniModel || configManager.getMainModel();
  }

  static getNanoModel(): string {
    const configManager = LLMConfigurationManager.getInstance();
    const nanoModel = configManager.getNanoModel();
    const miniModel = configManager.getMiniModel();
    const mainModel = configManager.getMainModel();

    // Fallback hierarchy: nano -> mini -> main
    return nanoModel || miniModel || mainModel;
  }

  static getNanoModelWithProvider(): { model: string, provider: LLMProvider } {
    const configManager = LLMConfigurationManager.getInstance();
    const modelName = AIChatPanel.getNanoModel();
    const provider = configManager.getProvider();

    return {
      model: modelName,
      provider: provider
    };
  }

  static getMiniModelWithProvider(): { model: string, provider: LLMProvider } {
    const configManager = LLMConfigurationManager.getInstance();
    const modelName = AIChatPanel.getMiniModel();
    const provider = configManager.getProvider();

    return {
      model: modelName,
      provider: provider
    };
  }

  static getProviderForModel(modelName: string): LLMProvider {
    // Get model options lookup
    const allModelOptions = AIChatPanel.getModelOptions();
    const modelOption = allModelOptions.find(option => option.value === modelName);
    const originalProvider = (modelOption?.type as LLMProvider) || 'openai';

    // Check if the model's original provider is available in the registry
    if (LLMProviderRegistry.hasProvider(originalProvider)) {
      return originalProvider;
    }

    // If the original provider isn't available, fall back to the currently selected provider
    const currentProvider = localStorage.getItem(PROVIDER_SELECTION_KEY) || 'openai';
    logger.debug(`Provider ${originalProvider} not available for model ${modelName}, falling back to current provider: ${currentProvider}`);
    return currentProvider as LLMProvider;
  }

  /**
   * Gets the currently selected provider from localStorage
   * @returns The currently selected provider
   */
  static getCurrentProvider(): 'openai' | 'litellm' | 'groq' | 'openrouter' | 'browseroperator' {
    return (localStorage.getItem(PROVIDER_SELECTION_KEY) || 'openai') as 'openai' | 'litellm' | 'groq' | 'openrouter' | 'browseroperator';
  }

  /**
   * Checks if a model supports vision/multimodal capabilities
   * @param modelName The model name to check
   * @returns True if the model supports vision, false otherwise
   */
  static async isVisionCapable(modelName: string): Promise<boolean> {
    logger.debug(`[Vision Check] Checking vision capability for model: ${modelName}`);
    
    // First, try to get the provider for this model and use its vision detection API
    try {
      const provider = AIChatPanel.getProviderForModel(modelName);
      logger.debug(`[Vision Check] Model ${modelName} uses provider: ${provider}`);
      
      if (provider === 'openrouter') {
        // Use OpenRouter's API-based vision detection
        const { LLMProviderRegistry } = await import('../LLM/LLMProviderRegistry.js');
        const providerInstance = LLMProviderRegistry.getProvider('openrouter') as any;
        
        if (providerInstance && typeof providerInstance.supportsVision === 'function') {
          const isVision = await providerInstance.supportsVision(modelName);
          logger.info(`[Vision Check] OpenRouter API result for ${modelName}: ${isVision}`);
          return isVision;
        }
      }
      
      // For other providers, try the registry approach
      const llmClient = LLMClient.getInstance();
      const allModels = await llmClient.getAvailableModels();
      logger.debug(`[Vision Check] Got ${allModels.length} models from registry`);
      
      const modelInfo = allModels.find(model => model.id === modelName);
      
      if (modelInfo && modelInfo.capabilities) {
        const isVision = modelInfo.capabilities.vision;
        logger.info(`[Vision Check] Model ${modelName} vision capability from registry: ${isVision}`);
        return isVision;
      }
      
    } catch (error) {
      logger.warn(`[Vision Check] Provider-specific vision check failed for ${modelName}:`, error);
    }
    
    // Fallback: Check if model name contains known vision model patterns
    const modelNameWithoutPrefix = modelName.toLowerCase().replace(/^[^/]+\//, '');
    logger.debug(`[Vision Check] Falling back to pattern matching - Original: ${modelName}, Without prefix: ${modelNameWithoutPrefix}`);
    
    const visionModelPatterns = [
      'gpt-4', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-vision',
      'claude-3', 'claude-3-haiku', 'claude-3-sonnet', 'claude-3-opus', 'claude-3.5-sonnet', 'claude-4',
      'gemini', 'gemini-pro', 'gemini-2.5', 'gemini-pro-vision',
      'llava', 'vision', 'multimodal'
    ];
    
    const matchedPattern = visionModelPatterns.find(pattern => 
      modelNameWithoutPrefix.includes(pattern.toLowerCase()) ||
      modelName.toLowerCase().includes(pattern.toLowerCase())
    );
    
    const isVisionFromPattern = !!matchedPattern;
    logger.info(`[Vision Check] Pattern matching result for ${modelName}: ${isVisionFromPattern}${matchedPattern ? ` (matched: ${matchedPattern})` : ''}`);
    
    return isVisionFromPattern;
  }

  
  /**
   * Gets all model options or filters by provider
   * @param provider Optional provider to filter by
   * @returns Array of model options
   */
  static getModelOptions(provider?: ProviderType): ModelOption[] {
    const configManager = LLMConfigurationManager.getInstance();
    if (provider) {
      return configManager.getModelOptions(provider);
    }
    return configManager.getAllModelOptions();
  }
  
  /**
   * Updates model options with new provider models
   * Delegates to centralized LLMConfigurationManager
   * @param providerModels Models fetched from any provider (LiteLLM, Groq, etc.)
   * @param _hadWildcard Whether LiteLLM returned a wildcard model (kept for backward compatibility)
   * @returns Updated model options
   */
  static updateModelOptions(providerModels: ModelOption[] = [], _hadWildcard = false): ModelOption[] {
    const configManager = LLMConfigurationManager.getInstance();

    // Determine provider from the models
    if (providerModels.length > 0) {
      const provider = providerModels[0].type;
      configManager.setModelOptions(provider, providerModels);
    }

    // Sync local MODEL_OPTIONS
    syncModelOptions();

    logger.info('Updated model options via configManager:', {
      provider: configManager.getProvider(),
      modelCount: MODEL_OPTIONS.length
    });

    return configManager.getAllModelOptions();
  }
  
  /**
   * Adds a custom model to the options
   * Delegates to centralized LLMConfigurationManager
   * @param modelName Name of the model to add
   * @param modelType Type of the model ('openai' or 'litellm')
   * @returns Updated model options
   */
  static addCustomModelOption(modelName: string, modelType?: ProviderType): ModelOption[] {
    const configManager = LLMConfigurationManager.getInstance();
    configManager.addCustomModelOption(modelName, modelType);

    // Sync local MODEL_OPTIONS
    syncModelOptions();

    return configManager.getAllModelOptions();
  }
  
  /**
   * Clears cached model data to force refresh from defaults
   * Delegates to centralized LLMConfigurationManager
   */
  static clearModelCache(): void {
    const configManager = LLMConfigurationManager.getInstance();
    configManager.clearModelOptions();
    syncModelOptions();
    logger.info('Cleared model cache via configManager');
  }

  /**
   * Removes a custom model from the options
   * Delegates to centralized LLMConfigurationManager
   * @param modelName Name of the model to remove
   * @returns Updated model options
   */
  static removeCustomModelOption(modelName: string): ModelOption[] {
    const configManager = LLMConfigurationManager.getInstance();
    configManager.removeCustomModelOption(modelName);

    // Sync local MODEL_OPTIONS
    syncModelOptions();

    return configManager.getAllModelOptions();
  }

  static readonly panelName = 'ai-chat';

  // TODO: Move messages to a separate state object
  #messages: ChatMessage[] = [];
  #chatView!: ChatView; // Using the definite assignment assertion
  #toolbarContainer!: HTMLDivElement;
  #chatViewContainer!: HTMLDivElement;
  #agentService = AgentService.getInstance();
  #isProcessing = false;
  #imageInput?: ImageInputData;
  #selectedAgentType: string | null = null;
  #selectedModel: string = MODEL_OPTIONS.length > 0 ? MODEL_OPTIONS[0].value : ''; // Default to first model if available
  #miniModel = ''; // Mini model selection
  #nanoModel = ''; // Nano model selection
  #canSendMessages = false; // Add flag to track if we can send messages (has required credentials)

  // Native UI.Toolbar instances and buttons
  #leftToolbar!: UI.Toolbar.Toolbar;
  #rightToolbar!: UI.Toolbar.Toolbar;
  #newChatButton!: UI.Toolbar.ToolbarButton;
  #bookmarkButton!: UI.Toolbar.ToolbarButton;
  #settingsMenuButton!: UI.Toolbar.ToolbarMenuButton;
  #closeButton!: UI.Toolbar.ToolbarButton;
  #liteLLMApiKey: string | null = null; // LiteLLM API key
  #liteLLMEndpoint: string | null = null; // LiteLLM endpoint
  #apiKey: string | null = null; // Regular API key
  #evaluationAgent: EvaluationAgent | null = null; // Evaluation agent for this tab
  #mcpUnsubscribe: (() => void) | null = null;
  #configManager: LLMConfigurationManager;
  #agentStudioView: AgentStudioView | null = null; // Agent Studio view

  // Store bound event listeners to properly add/remove without duplications
  #boundOnMessagesChanged?: (e: Common.EventTarget.EventTargetEvent<ChatMessage[]>) => void;
  #boundOnAgentSessionStarted?: (e: Common.EventTarget.EventTargetEvent<import('../agent_framework/AgentSessionTypes.js').AgentSession>) => void;
  #boundOnConversationSaved?: (e: Common.EventTarget.EventTargetEvent<string>) => void;
  #boundOnConversationChanged?: (e: Common.EventTarget.EventTargetEvent<string | null>) => void;
  #boundOnAgentToolStarted?: (e: Common.EventTarget.EventTargetEvent<{ session: import('../agent_framework/AgentSessionTypes.js').AgentSession, toolCall: import('../agent_framework/AgentSessionTypes.js').AgentMessage }>) => void;
  #boundOnAgentToolCompleted?: (e: Common.EventTarget.EventTargetEvent<{ session: import('../agent_framework/AgentSessionTypes.js').AgentSession, toolResult: import('../agent_framework/AgentSessionTypes.js').AgentMessage }>) => void;
  #boundOnAgentSessionUpdated?: (e: Common.EventTarget.EventTargetEvent<import('../agent_framework/AgentSessionTypes.js').AgentSession>) => void;
  #boundOnChildAgentStarted?: (e: Common.EventTarget.EventTargetEvent<{ parentSession: import('../agent_framework/AgentSessionTypes.js').AgentSession, childAgentName: string, childSessionId: string }>) => void;

  constructor() {
    super(AIChatPanel.panelName);

    // Initialize configuration manager
    this.#configManager = LLMConfigurationManager.getInstance();

    // Initialize storage monitoring for debugging
    StorageMonitor.getInstance();
    
    // Prepare bound handlers once so removeEventListener works correctly
    this.#boundOnMessagesChanged = this.#handleMessagesChanged.bind(this);
    this.#boundOnAgentSessionStarted = this.#handleAgentSessionStarted.bind(this);
    this.#boundOnAgentToolStarted = this.#handleAgentToolStarted.bind(this);
    this.#boundOnAgentToolCompleted = this.#handleAgentToolCompleted.bind(this);
    this.#boundOnAgentSessionUpdated = this.#handleAgentSessionUpdated.bind(this);
    this.#boundOnChildAgentStarted = this.#handleChildAgentStarted.bind(this);
    this.#boundOnConversationSaved = this.#handleConversationSaved.bind(this);
    this.#boundOnConversationChanged = this.#handleConversationChanged.bind(this);

    this.#setupUI();
    this.#setupInitialState();
    this.#setupOAuthEventListeners();
    this.#initializeAgentService();
    this.#createEvaluationAgentIfNeeded();
    this.performUpdate();
    this.#fetchLiteLLMModelsOnLoad();
    // Initialize MCP integration (connect + discover tools if enabled)
    this.#setupMCPIntegration();
  }

  /**
   * Sets up the UI components and layout
   */
  #setupUI(): void {
    // Register CSS styles
    this.registerRequiredCSS(chatViewStyles);

    // Set flex layout for the content element to ensure it takes full height
    this.contentElement.style.display = 'flex';
    this.contentElement.style.flexDirection = 'column';
    this.contentElement.style.height = '100%';

    // Create container for the toolbar
    this.#toolbarContainer = document.createElement('div');
    this.#toolbarContainer.classList.add('toolbar-container');
    this.#toolbarContainer.setAttribute('role', 'toolbar');
    this.#toolbarContainer.style.cssText = 'display: flex; justify-content: space-between; width: 100%; padding: 0 4px; box-sizing: border-box; margin: 0 0 10px 0;';
    this.contentElement.appendChild(this.#toolbarContainer);

    // Create left toolbar using DOM method (not constructor)
    this.#leftToolbar = this.#toolbarContainer.createChild('devtools-toolbar', 'ai-chat-left-toolbar') as UI.Toolbar.Toolbar;

    // Create right toolbar using DOM method (not constructor)
    this.#rightToolbar = this.#toolbarContainer.createChild('devtools-toolbar', 'ai-chat-right-toolbar') as UI.Toolbar.Toolbar;
    this.#rightToolbar.style.cssText = 'overflow: visible;';

    // Create toolbar buttons ONCE
    this.#newChatButton = new UI.Toolbar.ToolbarButton(
      i18nString(UIStrings.newChat),
      'plus',
      undefined,
      'ai-chat.new-chat'
    );
    this.#newChatButton.addEventListener(
      UI.Toolbar.ToolbarButton.Events.CLICK,
      this.#onNewChatClick,
      this
    );

    this.#bookmarkButton = new UI.Toolbar.ToolbarButton(
      i18nString(UIStrings.bookmarkPage),
      'download',
      undefined,
      'ai-chat.bookmark-page'
    );
    this.#bookmarkButton.addEventListener(
      UI.Toolbar.ToolbarButton.Events.CLICK,
      this.#onBookmarkClick,
      this
    );

    this.#settingsMenuButton = this.#createSettingsMenuButton();

    this.#closeButton = new UI.Toolbar.ToolbarButton(
      'Close Chat Window',
      'cross',
      undefined,
      'ai-chat.close-devtools'
    );
    this.#closeButton.addEventListener(
      UI.Toolbar.ToolbarButton.Events.CLICK,
      () => Host.InspectorFrontendHost.InspectorFrontendHostInstance.closeWindow(),
      this
    );

    // Add buttons to toolbars ONCE (order matters for right toolbar)
    this.#leftToolbar.appendToolbarItem(this.#newChatButton);
    this.#rightToolbar.appendToolbarItem(this.#settingsMenuButton);
    this.#rightToolbar.appendToolbarItem(this.#closeButton);

    // Create container for the chat view
    this.#chatViewContainer = document.createElement('div');
    this.#chatViewContainer.style.flex = '1';
    this.#chatViewContainer.style.overflow = 'hidden';
    this.contentElement.appendChild(this.#chatViewContainer);

    // Create ChatView and append it to its container
    this.#chatView = new ChatView();
    this.#chatView.style.flexGrow = '1';
    this.#chatView.style.overflow = 'auto';
    this.#chatViewContainer.appendChild(this.#chatView);

    // Add event listener for manual setup requests from ChatView
    this.#chatView.addEventListener('manual-setup-requested', this.#handleManualSetupRequest.bind(this));
  }

  /**
   * Initialize MCP integration: connect and discover tools if enabled,
   * and react to MCP config changes from Settings.
   */
  #setupMCPIntegration(): void {
    const initAndRefresh = async () => {
      try {
        // Attempt to connect to MCP on startup. For OAuth, this will not trigger login
        // until the user explicitly clicks Connect in Settings.
        await MCPRegistry.init(false);
        await MCPRegistry.refresh();
        const status = MCPRegistry.getStatus();
        logger.info('MCP auto-connect completed', status);
      } catch (err) {
        logger.error('Failed to initialize MCP', err);
      }
    };

    void initAndRefresh();
    // Subscribe to config changes
    this.#mcpUnsubscribe = onMCPConfigChange(() => { void initAndRefresh(); });
  }

  /**
   * Sets up the initial state from localStorage
   */
  #setupInitialState(): void {
    // Load API keys and configurations from localStorage first
    this.#apiKey = localStorage.getItem('ai_chat_api_key');
    this.#liteLLMApiKey = localStorage.getItem(LITELLM_API_KEY_STORAGE_KEY);
    this.#liteLLMEndpoint = localStorage.getItem(LITELLM_ENDPOINT_KEY);
    
    // Load agent type if previously set
    const savedAgentType = localStorage.getItem('ai_chat_agent_type');
    if (savedAgentType) {
      this.#selectedAgentType = savedAgentType;
    }

    this.#setupModelOptions();
    
    // Only add welcome message if credentials are available (no OAuth login needed)
    if (this.#hasAnyProviderCredentials()) {
      this.#messages.push({
        entity: ChatMessageEntity.MODEL,
        action: 'final',
        answer: i18nString(UIStrings.welcomeMessage),
        isFinalAnswer: true,
      });
    }
  }

  /**
   * Sets up model options based on provider and stored preferences
   */
  #setupModelOptions(): void {
    const configManager = LLMConfigurationManager.getInstance();

    // Sync local MODEL_OPTIONS from the centralized manager
    syncModelOptions();

    // Validate and fix model selections using centralized manager
    const corrected = configManager.validateAndFixModelSelections();

    // Apply the corrected values to instance state
    this.#selectedModel = corrected.main;
    this.#miniModel = corrected.mini;
    this.#nanoModel = corrected.nano;

    logger.info('Setup model options:', {
      provider: configManager.getProvider(),
      selectedModel: this.#selectedModel,
      miniModel: this.#miniModel,
      nanoModel: this.#nanoModel
    });
  }

  /**
   * Public wrapper for testing the model validation logic
   * @internal This method is for testing purposes only
   */
  validateAndFixModelSelectionsForTesting(): boolean {
    return this.#validateAndFixModelSelections();
  }

  /**
   * Validates and fixes model selections to ensure they exist in the current provider
   * Returns true if all models are valid, false if any needed to be fixed
   * Delegates to centralized LLMConfigurationManager
   */
  #validateAndFixModelSelections(): boolean {
    const configManager = LLMConfigurationManager.getInstance();

    // Track previous values to determine if changes were made
    const prevMain = this.#selectedModel;
    const prevMini = this.#miniModel;
    const prevNano = this.#nanoModel;

    // Delegate to centralized validation
    const corrected = configManager.validateAndFixModelSelections();

    // Apply corrected values to instance state
    this.#selectedModel = corrected.main;
    this.#miniModel = corrected.mini;
    this.#nanoModel = corrected.nano;

    // Return true if no changes were needed
    const allValid = prevMain === corrected.main &&
                     prevMini === corrected.mini &&
                     prevNano === corrected.nano;

    if (!allValid) {
      logger.info('Model selections were fixed:', {
        main: { from: prevMain, to: corrected.main },
        mini: { from: prevMini, to: corrected.mini },
        nano: { from: prevNano, to: corrected.nano }
      });
    }

    return allValid;
  }

  /**
   * Sets up event listeners for OAuth authentication events
   */
  #setupOAuthEventListeners(): void {
    // Listen for OAuth success events
    window.addEventListener('openrouter-oauth-success', async () => {
      logger.info('=== OAUTH SUCCESS EVENT RECEIVED IN AICHATPANEL ===');
      logger.info('Timestamp:', new Date().toISOString());
      logger.info('Current localStorage state for OpenRouter:');
      const apiKey = localStorage.getItem('ai_chat_openrouter_api_key');
      const authMethod = localStorage.getItem('openrouter_auth_method');
      logger.info('- API key exists:', !!apiKey);
      logger.info('- API key length:', apiKey?.length || 0);
      logger.info('- Auth method:', authMethod);
      
      // Auto-fetch OpenRouter models after successful OAuth
      if (apiKey) {
        try {
          logger.info('Auto-fetching OpenRouter models after OAuth success...');
          await this.#autoFetchOpenRouterModels(apiKey);
          logger.info('Successfully auto-fetched OpenRouter models');
        } catch (error) {
          logger.warn('Failed to auto-fetch OpenRouter models after OAuth:', error);
        }
      }
      
      logger.info('Re-initializing agent service after OAuth success...');
      this.#initializeAgentService();
    });
    
    // Listen for OAuth logout events  
    window.addEventListener('openrouter-oauth-logout', () => {
      logger.info('=== OAUTH LOGOUT EVENT RECEIVED IN AICHATPANEL ===');
      logger.info('Re-initializing agent service after OAuth logout...');
      this.#initializeAgentService();
    });

    // Listen for localStorage changes (covers manual API key changes too)
    window.addEventListener('storage', (event) => {
      if (event.key === 'ai_chat_openrouter_api_key' || 
          event.key === 'openrouter_auth_method') {
        logger.info('=== STORAGE CHANGE EVENT FOR OPENROUTER ===');
        logger.info('Changed key:', event.key);
        logger.info('Old value exists:', !!event.oldValue);
        logger.info('New value exists:', !!event.newValue);
        logger.info('New value length:', event.newValue?.length || 0);
        logger.info('Re-initializing agent service after storage change...');
        this.#initializeAgentService();
      }
    });
  }

  getSelectedModel(): string {
    return this.#selectedModel;
  }

  /**
   * Set LLM configuration programmatically (for manual mode and persistent automated mode)
   */
  setLLMConfiguration(config: import('../core/LLMConfigurationManager.js').LLMConfig): void {
    logger.info('Setting LLM configuration programmatically', {
      provider: config.provider,
      mainModel: config.mainModel,
      hasApiKey: !!config.apiKey
    });

    // Save configuration to localStorage
    this.#configManager.saveConfiguration(config);

    // Refresh the agent service with new configuration
    this.refreshCredentials();
  }

  /**
   * Public method to refresh credential validation and agent service
   * Can be called from settings dialog or other components
   */
  refreshCredentials(): void {
    logger.info('=== MANUAL CREDENTIAL REFRESH REQUESTED ===');
    logger.info('Timestamp:', new Date().toISOString());
    logger.info('Current OpenRouter storage state:');
    const apiKey = localStorage.getItem('ai_chat_openrouter_api_key');
    const authMethod = localStorage.getItem('openrouter_auth_method');
    logger.info('- API key exists:', !!apiKey);
    logger.info('- API key length:', apiKey?.length || 0);
    logger.info('- Auth method:', authMethod);
    logger.info('Calling #initializeAgentService()...');
    this.#initializeAgentService();
  }

  /**
   * Fetches LiteLLM models on initial load if needed
   */
  async #fetchLiteLLMModelsOnLoad(): Promise<void> {
    const selectedProvider = localStorage.getItem(PROVIDER_SELECTION_KEY) || 'openai';
    
    // Only fetch LiteLLM models if we're using LiteLLM provider
    if (selectedProvider === 'litellm') {
      await this.#refreshLiteLLMModels();
    } else {
      // Just update model options with empty LiteLLM models
      this.#updateModelOptions([], false);
    }
  }

  /**
   * Refreshes the list of LiteLLM models from the configured endpoint
   */
  async #refreshLiteLLMModels(): Promise<void> {
    const liteLLMApiKey = localStorage.getItem(LITELLM_API_KEY_STORAGE_KEY);
    const endpoint = localStorage.getItem(LITELLM_ENDPOINT_KEY);

    if (!endpoint) {
      logger.info('No LiteLLM endpoint configured, skipping refresh');
      // Update with empty LiteLLM models but keep any custom models
      AIChatPanel.updateModelOptions([], false);
      this.performUpdate();
      return;
    }
    
    try {
      const { models: litellmModels, hadWildcard } = await this.#fetchLiteLLMModels(liteLLMApiKey, endpoint);
      // Use the static method
      AIChatPanel.updateModelOptions(litellmModels, hadWildcard);
      this.performUpdate();
    } catch (error) {
      logger.error('Failed to refresh LiteLLM models:', error);
      // Clear LiteLLM models on error
      AIChatPanel.updateModelOptions([], false);
      this.performUpdate();
    }
  }

  /**
   * Fetches LiteLLM models from the specified endpoint
   * @param apiKey API key to use for the request (optional)
   * @param endpoint The LiteLLM endpoint URL
   * @returns Object containing models and wildcard flag
   */
  async #fetchLiteLLMModels(apiKey: string | null, endpoint?: string): Promise<{models: ModelOption[], hadWildcard: boolean}> {
    try {
      // Only attempt to fetch if an endpoint is provided
      if (!endpoint) {
        logger.info('No LiteLLM endpoint provided, skipping model fetch');
        return { models: [], hadWildcard: false };
      }

      // Always fetch fresh models from LiteLLM
      const models = await LLMClient.fetchLiteLLMModels(apiKey, endpoint);

      // Check if wildcard model exists
      const hadWildcard = models.some(model => model.id === '*');

      // Filter out the wildcard "*" model as it's not a real model
      const filteredModels = models.filter(model => model.id !== '*');

      // Transform the models to the format we need
      const litellmModels = filteredModels.map(model => ({
        value: model.id,  // Store actual model name
        label: `LiteLLM: ${model.id}`,
        type: 'litellm' as const
      }));

      logger.info(`Fetched ${litellmModels.length} LiteLLM models, hadWildcard: ${hadWildcard}`);
      return { models: litellmModels, hadWildcard };
    } catch (error) {
      logger.error('Failed to fetch LiteLLM models:', error);
      // Return empty array on error - no default models
      return { models: [], hadWildcard: false };
    }
  }

  /**
   * Instance method that delegates to the static method to update model options
   * @param litellmModels LiteLLM models to add to options
   * @param hadWildcard Whether LiteLLM returned a wildcard model
   */
  #updateModelOptions(litellmModels: ModelOption[], hadWildcard = false): void {
    // Call the static method
    AIChatPanel.updateModelOptions(litellmModels, hadWildcard);
  }

  /**
   * Determines the status of the selected model
   * @param modelValue The model value to check
   * @returns Object with isLiteLLM and isPlaceholder flags
   */
  #getModelStatus(modelValue: string): { isLiteLLM: boolean, isPlaceholder: boolean } {
    if (!modelValue) {
      logger.warn('getModelStatus called with empty model value');
      return {
        isLiteLLM: false,
        isPlaceholder: false
      };
    }
    
    const modelOption = MODEL_OPTIONS.find(opt => opt.value === modelValue);
    
    if (!modelOption) {
      logger.warn(`Model ${modelValue} not found in MODEL_OPTIONS`);
    }
    
    return {
      isLiteLLM: Boolean(modelOption?.type === 'litellm'),
      isPlaceholder: Boolean(
        modelOption?.value === MODEL_PLACEHOLDERS.ADD_CUSTOM || 
        modelOption?.value === MODEL_PLACEHOLDERS.NO_MODELS
      ),
    };
  }

  /**
   * Create EvaluationAgent instance if evaluation is enabled
   */
  async #createEvaluationAgentIfNeeded(): Promise<void> {
    if (isEvaluationEnabled()) {
      try {
        // Disconnect existing agent if any
        if (this.#evaluationAgent) {
          this.#evaluationAgent.disconnect();
          this.#evaluationAgent = null;
        }

        const config = getEvaluationConfig();
        const target = SDK.TargetManager.TargetManager.instance().primaryPageTarget();
        const tabId = target?.id() || 'unknown';
        const compositeClientId = `${config.clientId}:${tabId}`;

        logger.info('Creating EvaluationAgent for tab', {
          tabId,
          compositeClientId,
          endpoint: config.endpoint
        });

        this.#evaluationAgent = new EvaluationAgent({
          clientId: compositeClientId,
          endpoint: config.endpoint,
          secretKey: config.secretKey,
          judgeModel: this.#selectedModel,
          miniModel: this.#miniModel,
          nanoModel: this.#nanoModel,
        });

        await this.#evaluationAgent.connect();
        logger.info('EvaluationAgent connected successfully for tab', { tabId });
      } catch (error) {
        logger.error('Failed to create EvaluationAgent:', error);
        // Don't throw - evaluation connection failure shouldn't break the panel
      }
    }
  }

  /**
   * Initialize the agent service based on the current provider and configuration
   */
  #initializeAgentService(): void {
    logger.info("=== INITIALIZING AGENT SERVICE ===");
    logger.info('Timestamp:', new Date().toISOString());
    
    // Get the selected provider and check model status
    const selectedProvider = localStorage.getItem(PROVIDER_SELECTION_KEY) || 'openai';
    logger.info('Selected provider:', selectedProvider);
    logger.info('Selected model:', this.#selectedModel);
    
    const { isPlaceholder } = this.#getModelStatus(this.#selectedModel);
    logger.info('Model is placeholder:', isPlaceholder);
    
    // Don't initialize if the selected model is a placeholder
    if (isPlaceholder) {
      logger.warn('❌ Model is placeholder, cannot initialize agent service');
      this.#setCanSendMessagesState(false, "Selected model is a placeholder");
      return;
    }
    
    // Check credentials based on provider
    logger.info('=== CHECKING CREDENTIALS ===');
    const {canProceed, apiKey} = this.#checkCredentials(selectedProvider);
    logger.info('Credential check result:');
    logger.info('- Can proceed:', canProceed);
    logger.info('- API key exists:', !!apiKey);
    logger.info('- API key length:', apiKey?.length || 0);
    
    // Update state if we can't proceed
    if (!canProceed) {
      logger.error('❌ Cannot proceed - missing required credentials');
      this.#setCanSendMessagesState(false, "Missing required credentials");
      return;
    }
    
    logger.info('✅ Credentials valid, proceeding with agent service initialization');
    
    // Remove any existing listeners to prevent duplicates
    if (this.#boundOnMessagesChanged) this.#agentService.removeEventListener(AgentEvents.MESSAGES_CHANGED, this.#boundOnMessagesChanged);
    if (this.#boundOnAgentSessionStarted) this.#agentService.removeEventListener(AgentEvents.AGENT_SESSION_STARTED, this.#boundOnAgentSessionStarted);
    if (this.#boundOnAgentToolStarted) this.#agentService.removeEventListener(AgentEvents.AGENT_TOOL_STARTED, this.#boundOnAgentToolStarted);
    if (this.#boundOnAgentToolCompleted) this.#agentService.removeEventListener(AgentEvents.AGENT_TOOL_COMPLETED, this.#boundOnAgentToolCompleted);
    if (this.#boundOnAgentSessionUpdated) this.#agentService.removeEventListener(AgentEvents.AGENT_SESSION_UPDATED, this.#boundOnAgentSessionUpdated);
    if (this.#boundOnChildAgentStarted) this.#agentService.removeEventListener(AgentEvents.CHILD_AGENT_STARTED, this.#boundOnChildAgentStarted);
    if (this.#boundOnConversationSaved) this.#agentService.removeEventListener(AgentEvents.CONVERSATION_SAVED, this.#boundOnConversationSaved);
    if (this.#boundOnConversationChanged) this.#agentService.removeEventListener(AgentEvents.CONVERSATION_CHANGED, this.#boundOnConversationChanged);
    
    // Register for messages changed events
    if (this.#boundOnMessagesChanged) this.#agentService.addEventListener(AgentEvents.MESSAGES_CHANGED, this.#boundOnMessagesChanged);
    if (this.#boundOnAgentSessionStarted) this.#agentService.addEventListener(AgentEvents.AGENT_SESSION_STARTED, this.#boundOnAgentSessionStarted);
    if (this.#boundOnAgentToolStarted) this.#agentService.addEventListener(AgentEvents.AGENT_TOOL_STARTED, this.#boundOnAgentToolStarted);
    if (this.#boundOnAgentToolCompleted) this.#agentService.addEventListener(AgentEvents.AGENT_TOOL_COMPLETED, this.#boundOnAgentToolCompleted);
    if (this.#boundOnAgentSessionUpdated) this.#agentService.addEventListener(AgentEvents.AGENT_SESSION_UPDATED, this.#boundOnAgentSessionUpdated);
    if (this.#boundOnChildAgentStarted) this.#agentService.addEventListener(AgentEvents.CHILD_AGENT_STARTED, this.#boundOnChildAgentStarted);
    if (this.#boundOnConversationSaved) this.#agentService.addEventListener(AgentEvents.CONVERSATION_SAVED, this.#boundOnConversationSaved);
    if (this.#boundOnConversationChanged) this.#agentService.addEventListener(AgentEvents.CONVERSATION_CHANGED, this.#boundOnConversationChanged);
    
    // Initialize the agent service
    logger.info('Calling agentService.initialize()...');
    const miniForInit = this.#miniModel || this.#selectedModel;
    const nanoForInit = this.#nanoModel || miniForInit;
    this.#agentService.initialize(
        apiKey,
        this.#selectedModel,
        miniForInit,
        nanoForInit,
      )
      .then(() => {
        logger.info('✅ Agent service initialized successfully');
        this.#setCanSendMessagesState(true, "Agent service initialized successfully");
      })
      .catch(error => {
        logger.error('❌ Failed to initialize AgentService:', error);
        this.#setCanSendMessagesState(false, `Failed to initialize agent service: ${error instanceof Error ? error.message : String(error)}`);
      });
  }
  
  /**
   * Helper to set the canSendMessages state and update UI accordingly
   */
  #setCanSendMessagesState(canSend: boolean, reason: string): void {
    logger.info(`=== SETTING CAN SEND MESSAGES STATE ===`);
    logger.info(`Previous state: ${this.#canSendMessages}`);
    logger.info(`New state: ${canSend}`);
    logger.info(`Reason: ${reason}`);
    logger.info('Timestamp:', new Date().toISOString());
    
    this.#canSendMessages = canSend;
    this.#updateChatViewInputState();
    this.performUpdate();
    
    logger.info(`✅ State updated - canSendMessages is now: ${this.#canSendMessages}`);
  }
  
  /**
   * Check if any provider has valid credentials
   * @returns true if at least one provider has valid credentials
   */
  #hasAnyProviderCredentials(): boolean {
    const selectedProvider = localStorage.getItem(PROVIDER_SELECTION_KEY) || 'openai';

    // Define standard provider types
    const STANDARD_PROVIDER_TYPES: ProviderType[] = [
      'openai', 'litellm', 'groq', 'openrouter', 'browseroperator',
      'cerebras', 'anthropic', 'googleai'
    ];

    // Get custom providers dynamically
    const customProviders = CustomProviderManager.listEnabledProviders().map(p => p.id);

    // Combine standard and custom providers
    const ALL_PROVIDER_TYPES = [...STANDARD_PROVIDER_TYPES, ...customProviders];

    // Check all providers except LiteLLM (unless LiteLLM is selected)
    // LiteLLM is excluded by default because it requires endpoint configuration
    const providersToCheck = ALL_PROVIDER_TYPES.filter(provider =>
      provider !== 'litellm' || selectedProvider === 'litellm'
    );

    for (const provider of providersToCheck) {
      const validation = LLMClient.validateProviderCredentials(provider);
      if (validation.isValid) {
        return true;
      }
    }

    return false;
  }

  /**
   * Checks if required credentials are available based on provider using provider-specific validation
   * @param provider The selected provider ('openai', 'litellm', 'groq', 'openrouter', 'cerebras', 'anthropic', 'googleai', etc.)
   * @returns Object with canProceed flag and apiKey
   */
  #checkCredentials(provider: string): {canProceed: boolean, apiKey: string | null} {
    logger.info('=== CHECKING CREDENTIALS FOR PROVIDER ===');
    logger.info('Provider:', provider);
    logger.info('Timestamp:', new Date().toISOString());

    // Use centralized credential checking from LLMClient
    logger.info('Calling LLMClient.getProviderCredentials()...');
    const result = LLMClient.getProviderCredentials(provider);

    logger.info('Credential check result:');
    logger.info('- Can proceed:', result.canProceed);
    logger.info('- API key exists:', !!result.apiKey);
    logger.info('- API key length:', result.apiKey?.length || 0);
    if (result.endpoint) {
      logger.info('- Endpoint:', result.endpoint);
    }

    logger.info('=== CREDENTIAL CHECK COMPLETE ===');

    return {
      canProceed: result.canProceed,
      apiKey: result.apiKey
    };
  }

  /**
   * Update the ChatView's input state directly without doing a full performUpdate
   * This updates the placeholder text and input state
   */
  #updateChatViewInputState(): void {
    if (!this.#chatView) {
      return;
    }
    
    // Update ChatView data with current input state
    this.#chatView.data = {
      ...this.#chatView.data,
      isInputDisabled: false, // Keep the input field enabled for better UX
      inputPlaceholder: this.#getInputPlaceholderText()
    };
  }

  /**
   * Get the appropriate placeholder text based on configuration status
   */
  #getInputPlaceholderText(): string {
    const selectedProvider = localStorage.getItem(PROVIDER_SELECTION_KEY) || 'openai';
    
    if (this.#canSendMessages) {
      return i18nString(UIStrings.inputPlaceholder);
    } else if (selectedProvider === 'litellm') {
      return i18nString(UIStrings.missingLiteLLMEndpoint);
    } else {
      return i18nString(UIStrings.missingProviderCredentials);
    }
  }

  /**
   * Handle OAuth login request from ChatView
   */
  #handleOAuthLogin(): void {
    logger.info('OAuth login requested from ChatView');
    
    // Import OpenRouterOAuth dynamically if needed and start the OAuth flow
    import('../auth/OpenRouterOAuth.js').then(module => {
      const OpenRouterOAuth = module.OpenRouterOAuth;
      OpenRouterOAuth.startAuthFlow().catch(error => {
        logger.error('OAuth flow failed:', error);
        // Could show user notification here
      });
    }).catch(error => {
      logger.error('Failed to import OpenRouterOAuth:', error);
    });
  }

  /**
   * Auto-fetch OpenRouter models after successful OAuth authentication
   */
  async #autoFetchOpenRouterModels(apiKey: string): Promise<void> {
    try {
      logger.debug('Fetching OpenRouter models automatically after OAuth...');
      
      // Import LLMClient and SettingsDialog dynamically to fetch and update models
      const [{ LLMClient }, { SettingsDialog }] = await Promise.all([
        import('../LLM/LLMClient.js'),
        import('./SettingsDialog.js')
      ]);
      
      const openrouterModels = await LLMClient.fetchOpenRouterModels(apiKey);
      logger.debug(`Auto-fetched ${openrouterModels.length} OpenRouter models`);
      
      // Update models programmatically via SettingsDialog static method
      SettingsDialog.updateOpenRouterModels(openrouterModels);
      
      // Also update AIChatPanel's model options for immediate UI availability
      const modelOptions: ModelOption[] = openrouterModels.map(model => ({
        value: model.id,
        label: model.name || model.id,
        type: 'openrouter' as const,
      }));
      AIChatPanel.updateModelOptions(modelOptions, false);
      this.performUpdate();
      
      // Also dispatch event for backward compatibility / other listeners
      window.dispatchEvent(new CustomEvent('openrouter-models-fetched', {
        detail: { models: openrouterModels }
      }));
      
    } catch (error) {
      logger.error('Failed to auto-fetch OpenRouter models:', error);
      throw error;
    }
  }

  /**
   * Handle manual setup request from ChatView
   */
  #handleManualSetupRequest(): void {
    logger.info('Manual setup requested from ChatView');
    this.#onSettingsClick();
  }

  /**
   * Update the settings button highlight based on credentials state
   */
  #updateSettingsButtonHighlight(): void {
    if (!this.#canSendMessages) {
      // Add pulsating animation to draw attention to settings
      if (this.#settingsMenuButton && this.#settingsMenuButton.element) {
        // Add CSS animation to make it glow/pulse
        this.#settingsMenuButton.element.classList.add('settings-highlight');

        // Add the style to the document head if it doesn't exist yet
        const styleId = 'settings-highlight-style';
        if (!document.getElementById(styleId)) {
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = `
            .settings-highlight {
              animation: pulse 2s infinite;
              position: relative;
            }

            @keyframes pulse {
              0% {
                box-shadow: 0 0 0 0 rgba(var(--color-primary-rgb), 0.7);
              }
              70% {
                box-shadow: 0 0 0 6px rgba(var(--color-primary-rgb), 0);
              }
              100% {
                box-shadow: 0 0 0 0 rgba(var(--color-primary-rgb), 0);
              }
            }
          `;
          document.head.appendChild(style);
        }
      }
    } else if (this.#canSendMessages && this.#settingsMenuButton && this.#settingsMenuButton.element) {
      // Remove the highlight if we now have an API key
      this.#settingsMenuButton.element.classList.remove('settings-highlight');
    }
  }

  /**
   * Handle messages changed event from the agent service
   */
  #handleMessagesChanged(event: Common.EventTarget.EventTargetEvent<ChatMessage[]>): void {
    const messages = event.data;
    this.#messages = [...messages];

    // Check if we should exit processing state
    this.#updateProcessingState(messages);
    this.performUpdate();
  }
  
  /**
   * Handle agent session started event
   */
  #handleAgentSessionStarted(event: Common.EventTarget.EventTargetEvent<import('../agent_framework/AgentSessionTypes.js').AgentSession>): void {
    const session = event.data;
    this.#upsertAgentSessionMessage(session);
    this.performUpdate();
  }
  
  /**
   * Handle agent tool started event
   */
  #handleAgentToolStarted(event: Common.EventTarget.EventTargetEvent<{ session: import('../agent_framework/AgentSessionTypes.js').AgentSession, toolCall: import('../agent_framework/AgentSessionTypes.js').AgentMessage }>): void {
    const { session } = event.data;
    this.#upsertAgentSessionMessage(session);
    this.performUpdate();
  }
  
  /**
   * Handle agent tool completed event
   */
  #handleAgentToolCompleted(event: Common.EventTarget.EventTargetEvent<{ session: import('../agent_framework/AgentSessionTypes.js').AgentSession, toolResult: import('../agent_framework/AgentSessionTypes.js').AgentMessage }>): void {
    const { session } = event.data;
    this.#upsertAgentSessionMessage(session);
    this.performUpdate();
  }
  
  /**
   * Handle agent session updated event
   */
  #handleAgentSessionUpdated(event: Common.EventTarget.EventTargetEvent<import('../agent_framework/AgentSessionTypes.js').AgentSession>): void {
    const session = event.data;
    this.#upsertAgentSessionMessage(session);
    this.performUpdate();
  }
  
  /**
   * Handle child agent started event
   */
  #handleChildAgentStarted(event: Common.EventTarget.EventTargetEvent<{ parentSession: import('../agent_framework/AgentSessionTypes.js').AgentSession, childAgentName: string, childSessionId: string }>): void {
    const { parentSession } = event.data;
    this.#upsertAgentSessionMessage(parentSession);
    this.performUpdate();
  }

  /**
   * Handle conversation saved event
   */
  #handleConversationSaved(event: Common.EventTarget.EventTargetEvent<string>): void {
    const conversationId = event.data;
    logger.debug('Conversation saved event', {conversationId});
  }

  /**
   * Handle conversation changed event
   */
  async #handleConversationChanged(event: Common.EventTarget.EventTargetEvent<string | null>): Promise<void> {
    const conversationId = event.data;
    logger.debug('Conversation changed event', {conversationId});

    // Set the file storage session ID to the conversation ID
    if (conversationId) {
      const {FileStorageManager} = await import('../tools/FileStorageManager.js');
      FileStorageManager.getInstance().setSessionId(conversationId);
      logger.info('Set file storage sessionId to conversationId', {conversationId});

      // Refresh the file list to show files for this conversation
      if (this.#chatView) {
        await this.#chatView.refreshFileList();
      }
    }
  }

  /**
   * Upsert an AGENT_SESSION message into the messages array by sessionId
   */
  #upsertAgentSessionMessage(session: import('../agent_framework/AgentSessionTypes.js').AgentSession): void {
    const idx = this.#messages.findIndex(m => m.entity === ChatMessageEntity.AGENT_SESSION &&
      (m as any).agentSession?.sessionId === session.sessionId);
    if (idx >= 0) {
      const updated = { ...(this.#messages[idx] as any), agentSession: session };
      const next = [...this.#messages];
      next[idx] = updated;
      this.#messages = next;
    } else {
      const agentSessionMessage: ChatMessage = {
        entity: ChatMessageEntity.AGENT_SESSION,
        agentSession: session,
        summary: `${session.agentName} is executing...`
      } as any;
      this.#messages = [...this.#messages, agentSessionMessage];
    }
  }
  
  /**
   * Updates processing state based on the latest messages
   */
  #updateProcessingState(messages: ChatMessage[]): void {
    // Only set isProcessing to false if the last message is a final answer from the model
    const lastMessage = messages[messages.length - 1];
    
    // DEBUG: Log processing state check
    logger.info('updateProcessingState: Current isProcessing =', this.#isProcessing);
    if (lastMessage) {
      const checks = {
        hasMessage: !!lastMessage,
        isModelEntity: lastMessage.entity === ChatMessageEntity.MODEL,
        isFinalAction: 'action' in lastMessage && lastMessage.action === 'final',
        isFinalAnswer: 'isFinalAnswer' in lastMessage && lastMessage.isFinalAnswer
      };
      logger.info('Processing state checks:', checks);
      
      if (lastMessage &&
          lastMessage.entity === ChatMessageEntity.MODEL &&
          lastMessage.action === 'final' &&
          (lastMessage.isFinalAnswer || 'error' in lastMessage)) {
        logger.info('Setting isProcessing to false');
        this.#isProcessing = false;
      } else {
        logger.info('Not setting isProcessing to false - conditions not met');
      }
    }
  }

  /**
   * Handles model change from UI and reinitializes the agent service
   * @param model The newly selected model
   */
  async #handleModelChanged(model: string): Promise<void> {
    // Update local state and save to localStorage
    this.#selectedModel = model;
    localStorage.setItem(MODEL_SELECTION_KEY, model);

    // Refresh available models list when using LiteLLM
    const selectedProvider = localStorage.getItem(PROVIDER_SELECTION_KEY) || 'openai';
    if (selectedProvider === 'litellm') {
      await this.#refreshLiteLLMModels();
    }

    // Reinitialize the agent service with the new model
    this.#initializeAgentService();
  }

  /**
   * Public method to send a message (passed to ChatView)
   */
  async sendMessage(text: string, imageInput?: ImageInputData): Promise<void> {
    if (!text.trim() || this.#isProcessing) {
      return;
    }
    
    // If we can't send messages due to missing credentials, add error message and return
    if (!this.#canSendMessages) {
      this.#addUserMessage(text, imageInput);
      this.#addCredentialErrorMessage();
      return;
    }

    // Validate and fix model selections before proceeding
    const modelsValid = this.#validateAndFixModelSelections();
    
    // If validation fixed models, update the UI to reflect changes
    if (!modelsValid) {
      logger.info('Model selections were fixed, updating UI...');
      this.performUpdate();
    }

    // Validate that the selected model's provider is registered
    const modelProvider = AIChatPanel.getProviderForModel(this.#selectedModel);
    
    // Check if the provider is registered in the LLM registry
    if (!LLMProviderRegistry.hasProvider(modelProvider)) {
      logger.warn(`Provider ${modelProvider} not registered for model ${this.#selectedModel}, re-initializing...`);
      
      // Re-initialize the agent service to ensure provider is registered
      this.#initializeAgentService();
      
      // Check again after initialization
      if (!LLMProviderRegistry.hasProvider(modelProvider)) {
        this.#addUserMessage(text, imageInput);
        const errorMessage: ModelChatMessage = {
          entity: ChatMessageEntity.MODEL,
          action: 'final',
          error: `The ${modelProvider} provider is not properly initialized. Please check your API key and settings.`,
          isFinalAnswer: true,
        };
        this.#messages.push(errorMessage as ChatMessage);
        this.performUpdate();
        this.#setProcessingState(false);
        return;
      }
    }

    // Final validation: check if model exists in provider's available models
    const availableModels = AIChatPanel.getModelOptions(modelProvider);
    const modelExists = availableModels.some(model => model.value === this.#selectedModel);
    
    if (!modelExists) {
      logger.error(`Selected model ${this.#selectedModel} not found in ${modelProvider} provider's model list`);
      this.#addUserMessage(text, imageInput);
      const errorMessage: ModelChatMessage = {
        entity: ChatMessageEntity.MODEL,
        action: 'final',
        error: `The model "${this.#selectedModel}" is not available in the ${modelProvider} provider. Please fetch the latest models in Settings or select a different model.`,
        isFinalAnswer: true,
      };
      this.#messages.push(errorMessage as ChatMessage);
      this.performUpdate();
      this.#setProcessingState(false);
      return;
    }

    // Set processing state
    this.#setProcessingState(true);

    try {  
      // Pass the selected agent type to the agent service
      await this.#agentService.sendMessage(text, imageInput, this.#selectedAgentType);
      // MESSAGES_CHANGED event from the agent service will update with AI response
    } catch (error) {
      this.#handleSendMessageError(error);
    }
  }
  
  /**
   * Adds a user message to the conversation
   */
  #addUserMessage(text: string, imageInput?: ImageInputData): void {
    this.#messages.push({
      entity: ChatMessageEntity.USER,
      text,
      imageInput,
    });
    this.performUpdate();
  }
  
  /**
   * Adds an error message about missing credentials
   */
  #addCredentialErrorMessage(): void {
    const selectedProvider = localStorage.getItem(PROVIDER_SELECTION_KEY) || 'openai';
    
    // Generate provider name safely, with fallback
    const providerName = selectedProvider ? 
      selectedProvider.charAt(0).toUpperCase() + selectedProvider.slice(1) : 
      'Provider';
    
    // Generic error message that works for any provider
    let errorText = `${providerName} credentials are missing or invalid. Please configure them in Settings.`;
    
    // Special case for LiteLLM which needs endpoint configuration
    if (selectedProvider === 'litellm') {
      errorText = 'LiteLLM endpoint is not configured. Please add endpoint in Settings.';
    }
    
    const errorMessage: ModelChatMessage = {
      entity: ChatMessageEntity.MODEL,
      action: 'final',
      error: errorText,
      isFinalAnswer: true,
    };
    this.#messages.push(errorMessage as ChatMessage);
    this.performUpdate();
  }
  
  /**
   * Sets the processing state for the UI
   */
  #setProcessingState(isProcessing: boolean): void {
    this.#isProcessing = isProcessing;
    this.#imageInput = isProcessing ? undefined : this.#imageInput;
    this.performUpdate();
  }
  
  /**
   * Handles errors from sending messages
   */
  #handleSendMessageError(error: unknown): void {
    logger.error('Failed to send message:', error);
    this.#setProcessingState(false);
    
    const errorMessage: ModelChatMessage = {
      entity: ChatMessageEntity.MODEL,
      action: 'final',
      error: error instanceof Error ? error.message : String(error),
      isFinalAnswer: true,
    };
    
    this.#messages.push(errorMessage as ChatMessage);
    this.performUpdate();
  }

  override wasShown(): void {
    this.performUpdate();
    this.#chatView?.focus();

    // Show onboarding for first-time users
    if (OnboardingDialog.shouldShowOnboarding()) {
      OnboardingDialog.show(async () => {
        // Fetch models for the newly selected provider
        await this.#refreshModelsForCurrentProvider();
        // Sync MODEL_OPTIONS and validate model selections
        this.#setupModelOptions();
        // Re-initialize agent service with newly selected provider
        this.#initializeAgentService();
        // Refresh UI after onboarding completes
        this.performUpdate();
      });
      return;
    }

    // Refresh models when panel is shown to ensure we have the latest available models
    void this.#refreshModelsForCurrentProvider();
  }

  /**
   * Fetches and caches models for the current provider
   * Uses LLMProviderRegistry directly (doesn't require LLMClient initialization)
   */
  async #refreshModelsForCurrentProvider(): Promise<void> {
    const configManager = LLMConfigurationManager.getInstance();
    const provider = configManager.getProvider();

    try {
      const apiKey = LLMProviderRegistry.getProviderApiKey(provider as LLMProvider);
      if (!apiKey) {
        logger.debug(`No API key for provider ${provider}, skipping model refresh`);
        return;
      }

      const models = await LLMProviderRegistry.fetchProviderModels(provider as LLMProvider, apiKey);

      // Convert ModelInfo[] to ModelOption[] for UI caching
      const modelOptions = models.map(m => ({
        value: m.id,
        label: m.name || m.id,
        type: provider
      }));

      // Store in the configuration manager's cache
      configManager.setModelOptions(provider, modelOptions);
      logger.info(`Fetched and cached ${modelOptions.length} models for provider ${provider}`);
    } catch (error) {
      logger.error(`Failed to refresh models for provider ${provider}:`, error);
      // Don't clear cache on error - keep existing cached models if available
    }
  }

  /**
   * Cleanup when panel is hidden
   */
  override willHide(): void {
    // Cancel any running agent execution when the panel is hidden/reloaded
    try {
      this.#agentService.cancelRun();
    } catch {}
    // Explicitly remove any event listeners to prevent memory leaks
    if (this.#boundOnMessagesChanged) {
      this.#agentService.removeEventListener(AgentEvents.MESSAGES_CHANGED, this.#boundOnMessagesChanged);
    }
    if (this.#boundOnAgentSessionStarted) this.#agentService.removeEventListener(AgentEvents.AGENT_SESSION_STARTED, this.#boundOnAgentSessionStarted);
    if (this.#boundOnAgentToolStarted) this.#agentService.removeEventListener(AgentEvents.AGENT_TOOL_STARTED, this.#boundOnAgentToolStarted);
    if (this.#boundOnAgentToolCompleted) this.#agentService.removeEventListener(AgentEvents.AGENT_TOOL_COMPLETED, this.#boundOnAgentToolCompleted);
    if (this.#boundOnAgentSessionUpdated) this.#agentService.removeEventListener(AgentEvents.AGENT_SESSION_UPDATED, this.#boundOnAgentSessionUpdated);
    if (this.#boundOnChildAgentStarted) this.#agentService.removeEventListener(AgentEvents.CHILD_AGENT_STARTED, this.#boundOnChildAgentStarted);
  }

  // Test-only helpers
  getIsProcessingForTesting(): boolean {
    return this.#isProcessing;
  }

  setProcessingForTesting(flag: boolean): void {
    this.#setProcessingState(flag);
  }

  /**
   * Updates the UI components with the current state
   */
  override performUpdate(): void {
    this.#updateSettingsButtonHighlight();
    this.#updateChatViewState();
  }
  
  /**
   * Creates the settings menu button with dropdown items
   */
  #createSettingsMenuButton(): UI.Toolbar.ToolbarMenuButton {
    const menuButton = new UI.Toolbar.ToolbarMenuButton(
      (contextMenu) => {
        // Add menu items
        contextMenu.defaultSection().appendItem(
          'Settings',
          () => this.#onSettingsClick(),
          {jslogContext: 'settings'}
        );
        contextMenu.defaultSection().appendItem(
          i18nString(UIStrings.history),
          () => void this.#onHistoryClick(),
          {jslogContext: 'history'}
        );
        contextMenu.defaultSection().appendItem(
          'Help',
          () => this.#onHelpClick(),
          {jslogContext: 'help'}
        );
        contextMenu.defaultSection().appendItem(
          'Evaluations',
          () => this.#onEvaluationTestClick(),
          {jslogContext: 'evaluations'}
        );
        contextMenu.defaultSection().appendItem(
          'Connectors',
          () => this.#onMCPConnectorsClick(),
          {jslogContext: 'connectors'}
        );
        // contextMenu.defaultSection().appendItem(
        //   'Agent Studio',
        //   () => this.#onAgentStudioClick(),
        //   {jslogContext: 'agent-studio'}
        // );
      },
      true,  // isIconDropdown
      true,  // useSoftMenu
      'ai-chat.settings-menu',  // jslogContext
      'dots-vertical'  // iconName
    );

    menuButton.setTitle('Settings Menu');
    return menuButton;
  }

  /**
   * Updates the chat view with current state
   */
  #updateChatViewState(): void {
    if (!this.#chatView) {
      return;
    }
    
    try {
      this.#chatView.data = {
        onPromptSelected: this.#handlePromptSelected.bind(this),
        messages: this.#messages,
        onSendMessage: this.sendMessage.bind(this),
        state: this.#isProcessing ? ChatViewState.LOADING : ChatViewState.IDLE,
        imageInput: this.#imageInput,
        modelOptions: MODEL_OPTIONS,
        selectedModel: this.#selectedModel,
        onModelChanged: this.#handleModelChanged.bind(this),
        onModelSelectorFocus: this.#refreshLiteLLMModels.bind(this),
        selectedAgentType: this.#selectedAgentType,
        isModelSelectorDisabled: this.#isProcessing,
        isInputDisabled: false,
        inputPlaceholder: this.#getInputPlaceholderText(),
        currentProvider: localStorage.getItem(PROVIDER_SELECTION_KEY) || 'openai',
        // Add OAuth login state
        showOAuthLogin: (() => {
          if (BUILD_CONFIG.AUTOMATED_MODE) {
            return false;
          }
          const hasCredentials = this.#hasAnyProviderCredentials();
          return !hasCredentials;
        })(),
        onOAuthLogin: this.#handleOAuthLogin.bind(this),
        // Add example prompt model switching
        onExamplePromptModelSwitch: this.#handleExamplePromptModelSwitch.bind(this),
      };
    } catch (error) {
      logger.error('Error updating ChatView state:', error);
    }
  }

  /**
   * Handles prompt type selection from ChatView
   * @param promptType The selected prompt type (null means deselected)
   */
  #handlePromptSelected(promptType: string | null): void {
    logger.info('Prompt selected in AIChatPanel:', promptType);
    this.#selectedAgentType = promptType;
    // Save selection for future sessions
    if (promptType) {
      localStorage.setItem('ai_chat_agent_type', promptType);
    } else {
      localStorage.removeItem('ai_chat_agent_type');
    }
  }

  /**
   * Handles model switching when example prompts with model preferences are selected
   * Applies the provided model preferences to main, mini, and nano models
   */
  #handleExamplePromptModelSwitch(modelPreferences: { main?: string; mini?: string; nano?: string }): void {
    logger.info('=== HANDLE EXAMPLE PROMPT MODEL SWITCH ===');
    logger.info('Model preferences received:', modelPreferences);
    logger.info('Current provider:', localStorage.getItem(PROVIDER_SELECTION_KEY));
    logger.info('Current MODEL_OPTIONS count:', MODEL_OPTIONS.length);
    logger.info('Sample available models:', MODEL_OPTIONS.slice(0, 10).map(m => `${m.value} (${m.type})`));

    let modelsApplied = false;

    // Apply main model
    if (modelPreferences.main) {
      const exists = MODEL_OPTIONS.some(opt => opt.value === modelPreferences.main);
      logger.info(`Main model "${modelPreferences.main}" exists in MODEL_OPTIONS:`, exists);

      if (exists) {
        logger.info(`Previous main model: "${this.#selectedModel}"`);
        this.#selectedModel = modelPreferences.main;
        localStorage.setItem(MODEL_SELECTION_KEY, this.#selectedModel);
        modelsApplied = true;
        logger.info('✅ Applied main model:', modelPreferences.main);
      } else {
        logger.warn('❌ Main model not found in MODEL_OPTIONS:', modelPreferences.main);
        logger.warn('First 10 available models:', MODEL_OPTIONS.slice(0, 10).map(m => m.value));
        logger.warn('Hint: Make sure OpenRouter models are fetched before clicking example prompts');
      }
    }

    // Apply mini model
    if (modelPreferences.mini) {
      const exists = MODEL_OPTIONS.some(opt => opt.value === modelPreferences.mini);
      logger.info(`Mini model "${modelPreferences.mini}" exists in MODEL_OPTIONS:`, exists);

      if (exists) {
        logger.info(`Previous mini model: "${this.#miniModel}"`);
        this.#miniModel = modelPreferences.mini;
        localStorage.setItem(MINI_MODEL_STORAGE_KEY, this.#miniModel);
        modelsApplied = true;
        logger.info('✅ Applied mini model:', modelPreferences.mini);
      } else {
        logger.warn('❌ Mini model not found in MODEL_OPTIONS:', modelPreferences.mini);
      }
    }

    // Apply nano model
    if (modelPreferences.nano) {
      const exists = MODEL_OPTIONS.some(opt => opt.value === modelPreferences.nano);
      logger.info(`Nano model "${modelPreferences.nano}" exists in MODEL_OPTIONS:`, exists);

      if (exists) {
        logger.info(`Previous nano model: "${this.#nanoModel}"`);
        this.#nanoModel = modelPreferences.nano;
        localStorage.setItem(NANO_MODEL_STORAGE_KEY, this.#nanoModel);
        modelsApplied = true;
        logger.info('✅ Applied nano model:', modelPreferences.nano);
      } else {
        logger.warn('❌ Nano model not found in MODEL_OPTIONS:', modelPreferences.nano);
      }
    }

    // Update UI and reinitialize agent if any models were applied
    if (modelsApplied) {
      logger.info('✅ Model switch complete!');
      logger.info('New model selection:', {
        main: this.#selectedModel,
        mini: this.#miniModel,
        nano: this.#nanoModel
      });
      logger.info('Updating UI and reinitializing agent service with new models...');

      this.performUpdate();
      this.#initializeAgentService(); // ✅ Immediately reinitialize with new models

      logger.info('✅ Agent service reinitialization triggered');
    } else {
      logger.error('❌ No models were applied!');
      logger.error('Possible reasons:');
      logger.error('1. Models not loaded in MODEL_OPTIONS (try fetching OpenRouter models in Settings)');
      logger.error('2. Provider not set to openrouter');
      logger.error('3. Model IDs in example prompt config don\'t match actual OpenRouter model IDs');
      logger.error('Current MODEL_OPTIONS:', MODEL_OPTIONS.map(m => m.value));
    }
  }

  async #onNewChatClick(): Promise<void> {
    this.#agentService.clearConversation();
    this.#messages = this.#agentService.getMessages();
    this.#isProcessing = false;
    this.#selectedAgentType = null; // Reset selected agent type

    // Reset file storage session ID to a new unique ID for new chat
    const {FileStorageManager} = await import('../tools/FileStorageManager.js');
    const newSessionId = `temp-${crypto.randomUUID()}`;
    FileStorageManager.getInstance().setSessionId(newSessionId);
    logger.info('Set file storage sessionId for new chat', { sessionId: newSessionId });

    // Create new EvaluationAgent for new chat session
    this.#createEvaluationAgentIfNeeded();

    this.performUpdate();
    UI.ARIAUtils.LiveAnnouncer.alert(i18nString(UIStrings.newChatCreated));
  }

  /**
   * Loads a conversation from history
   */
  async #loadConversation(conversationId: string): Promise<void> {
    const success = await this.#agentService.loadConversation(conversationId);

    if (success) {
      this.#messages = this.#agentService.getMessages();
      this.#selectedAgentType = this.#agentService.getState().selectedAgentType || null;

      // Set file storage session ID to the conversation ID
      const {FileStorageManager} = await import('../tools/FileStorageManager.js');
      FileStorageManager.getInstance().setSessionId(conversationId);
      logger.info('Set file storage sessionId to conversationId', {conversationId});

      // Refresh the file list to show files for this conversation
      if (this.#chatView) {
        await this.#chatView.refreshFileList();
      }

      this.performUpdate();

      logger.info('Conversation loaded from history', {conversationId});
    } else {
      logger.error('Failed to load conversation', {conversationId});
    }
  }

  /**
   * Starts a new conversation
   */
  async #startNewConversation(): Promise<void> {
    await this.#agentService.newConversation();
    this.#messages = this.#agentService.getMessages();
    this.#isProcessing = false;
    this.#selectedAgentType = null;
    this.#createEvaluationAgentIfNeeded();
    this.performUpdate();

    logger.info('New conversation started from history dialog');
  }

  /**
   * Deletes a conversation
   */
  async #deleteConversation(conversationId: string): Promise<void> {
    const success = await this.#agentService.deleteConversation(conversationId);

    if (success) {
      logger.info('Conversation deleted', {conversationId});
    } else {
      logger.error('Failed to delete conversation', {conversationId});
    }
  }


  /**
   * Handles history button click to show conversation history dialog
   */
  async #onHistoryClick(): Promise<void> {
    const conversations = await this.#agentService.listConversations();
    const currentId = this.#agentService.getCurrentConversationId();

    // Create dialog
    const dialog = new UI.Dialog.Dialog();
    dialog.setDimmed(true);
    dialog.contentElement.classList.add('conversation-history-dialog');

    // Create the conversation history list component
    const historyList = new ConversationHistoryList();
    historyList.conversations = conversations;
    historyList.currentConversationId = currentId;
    historyList.onConversationSelected = (id) => this.#loadConversation(id);
    historyList.onDeleteConversation = (id) => this.#deleteConversation(id);
    historyList.onClose = () => dialog.hide();

    dialog.setOutsideClickCallback(() => dialog.hide());
    dialog.contentElement.appendChild(historyList);
    dialog.show();

    logger.info('Conversation history dialog opened');
  }

  #onHelpClick(): void {
    // Open external getting started docs in a new tab
    UI.UIUtils.openInNewTab('https://browseroperator.io/docs/getting-started/');
  }

  #onMCPConnectorsClick(): void {
    MCPConnectorsCatalogDialog.show({
      onClose: async () => {
        // Refresh MCP registry when catalog is closed in case new connectors were added
        try {
          await MCPRegistry.init(true);
          logger.info('MCP registry refreshed after catalog closed');
        } catch (error) {
          logger.error('Failed to refresh MCP registry after catalog closed', error);
        }
      }
    });
  }

  /**
   * Handles the Agent Studio button click event and shows the Agent Studio
   */
  #onAgentStudioClick(): void {
    if (!this.#agentStudioView) {
      this.#agentStudioView = new AgentStudioView();
    }
    void this.#agentStudioView.show();
  }

  /**
   * Handles the settings button click event and shows the settings dialog
   */
  #onSettingsClick(): void {
    SettingsDialog.show(
      this.#selectedModel,
      this.#miniModel,
      this.#nanoModel,
      async () => {
        await this.#handleSettingsChanged();
      },
      this.#fetchLiteLLMModels.bind(this),
      (providerModels, hadWildcard) => { AIChatPanel.updateModelOptions(providerModels, hadWildcard); },
      AIChatPanel.getModelOptions,
      AIChatPanel.addCustomModelOption,
      AIChatPanel.removeCustomModelOption
    );
  }
  
  /**
   * Handles the evaluation test button click event and shows the evaluation dialog
   */
  #onEvaluationTestClick(): void {
    EvaluationDialog.show();
  }

  /**
   * Handles the bookmark button click event and bookmarks the current page
   */
  async #onBookmarkClick(): Promise<void> {
    // Show immediate "working" notification that doesn't auto-dismiss
    const workingSnackbar = Snackbars.Snackbar.Snackbar.show({
      message: 'Bookmarking page...',
      closable: true, // Make it closable to prevent auto-dismiss
    });
    workingSnackbar.classList.add('bookmark-notification');
    this.#applyFullWidthSnackbarStyles(workingSnackbar);

    try {
      // Import the BookmarkStoreTool dynamically
      const { BookmarkStoreTool } = await import('../tools/BookmarkStoreTool.js');
      const bookmarkTool = new BookmarkStoreTool();

      // Get current page title for better user feedback
      const currentPageTitle = await this.#getCurrentPageTitle();
      
      // Execute the bookmark tool
      const result = await bookmarkTool.execute({
        reasoning: 'User clicked bookmark button to save current page',
        includeFullContent: true
      });

      // Close the working notification properly by clicking the close button
      const closeButton = workingSnackbar.shadowRoot?.querySelector('.dismiss') as HTMLElement;
      if (closeButton) {
        closeButton.click();
      }

      if (result.success) {
        // Show success snackbar with shorter duration
        const successMessage = result.message || `Successfully bookmarked "${result.title || currentPageTitle}"`;
        const snackbar = Snackbars.Snackbar.Snackbar.show({
          message: successMessage,
          closable: false,
        });
        snackbar.dismissTimeout = 3000; // 3 seconds instead of default 5
        snackbar.classList.add('bookmark-notification'); // Add custom CSS class
        this.#applyFullWidthSnackbarStyles(snackbar); // Apply full-width styles
        logger.info('Page bookmarked successfully', { url: result.url, title: result.title });
      } else {
        // Show error snackbar
        const errorSnackbar = Snackbars.Snackbar.Snackbar.show({
          message: `Failed to bookmark page: ${result.error}`,
          closable: true,
        });
        errorSnackbar.classList.add('bookmark-notification'); // Add custom CSS class
        this.#applyFullWidthSnackbarStyles(errorSnackbar); // Apply full-width styles
        logger.error('Failed to bookmark page', { error: result.error });
      }
    } catch (error: any) {
      // Close the working notification properly by clicking the close button
      const closeButton = workingSnackbar.shadowRoot?.querySelector('.dismiss') as HTMLElement;
      if (closeButton) {
        closeButton.click();
      }
      
      logger.error('Error in bookmark click handler', { error: error.message });
      // Show error snackbar
      const errorSnackbar = Snackbars.Snackbar.Snackbar.show({
        message: `Error bookmarking page: ${error.message}`,
        closable: true,
      });
      errorSnackbar.classList.add('bookmark-notification'); // Add custom CSS class
      this.#applyFullWidthSnackbarStyles(errorSnackbar); // Apply full-width styles
    }
  }

  /**
   * Apply full-width styles to snackbar for bookmark notifications
   */
  #applyFullWidthSnackbarStyles(snackbar: Snackbars.Snackbar.Snackbar): void {
    // Ensure the slideInFromTop animation is available globally
    this.#ensureGlobalSnackbarStyles();
    
    // Position below toolbar
    const toolbarOffset = 25; // Reduced height
    
    // Apply inline styles with !important to force override
    snackbar.style.setProperty('position', 'fixed', 'important');
    snackbar.style.setProperty('top', `${toolbarOffset}px`, 'important');
    snackbar.style.setProperty('left', '0', 'important');
    snackbar.style.setProperty('right', '0', 'important');
    snackbar.style.setProperty('bottom', 'unset', 'important');
    snackbar.style.setProperty('width', '100vw', 'important');
    snackbar.style.setProperty('max-width', 'none', 'important');
    snackbar.style.setProperty('margin', '0', 'important');
    snackbar.style.setProperty('z-index', '10000', 'important');
    
    // Apply styles to the container inside the snackbar
    setTimeout(() => {
      const container = snackbar.shadowRoot?.querySelector('.container') as HTMLElement;
      if (container) {
        container.style.width = '100%';
        container.style.maxWidth = '100%';
        container.style.borderRadius = '0';
        container.style.borderBottom = '1px solid var(--sys-color-divider)';
        container.style.animation = 'slideInFromTop 200ms cubic-bezier(0, 0, 0.3, 1)';
      }
    }, 0);
  }

  /**
   * Ensure global styles for bookmark snackbars are available
   */
  #ensureGlobalSnackbarStyles(): void {
    const styleId = 'bookmark-snackbar-styles';
    if (document.getElementById(styleId)) {
      return; // Already added
    }

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @keyframes slideInFromTop {
        from {
          transform: translateY(-100%);
          opacity: 0%;
        }
        to {
          transform: translateY(0);
          opacity: 100%;
        }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Get current page title for user feedback
   */
  async #getCurrentPageTitle(): Promise<string> {
    try {
      const target = SDK.TargetManager.TargetManager.instance().primaryPageTarget();
      if (!target) return 'Current Page';

      const runtimeModel = target.model(SDK.RuntimeModel.RuntimeModel);
      if (!runtimeModel) return 'Current Page';

      const executionContext = runtimeModel.defaultExecutionContext();
      if (!executionContext) return 'Current Page';

      const result = await executionContext.evaluate(
        {
          expression: 'document.title',
          objectGroup: 'temp',
          includeCommandLineAPI: false,
          silent: true,
          returnByValue: true,
          generatePreview: false
        },
        /* userGesture */ false,
        /* awaitPromise */ false
      );

      if ('error' in result) {
        return 'Current Page';
      }

      if (result.object && result.object.value) {
        return result.object.value;
      }
    } catch (error) {
      logger.warn('Failed to get current page title', { error });
    }
    return 'Current Page';
  }
  
  /**
   * Handles changes made in the settings dialog
   */
  async #handleSettingsChanged(): Promise<void> {
    const configManager = LLMConfigurationManager.getInstance();
    const newProvider = configManager.getProvider();

    logger.info(`Settings changed, current provider: ${newProvider}`);

    // Load saved settings (for instance properties)
    this.#apiKey = localStorage.getItem('ai_chat_api_key');
    this.#liteLLMApiKey = localStorage.getItem(LITELLM_API_KEY_STORAGE_KEY);
    this.#liteLLMEndpoint = localStorage.getItem(LITELLM_ENDPOINT_KEY);

    // Fetch models for the current provider
    await this.#refreshModelsForCurrentProvider();

    // Sync local MODEL_OPTIONS with the centralized manager
    syncModelOptions();

    // Use the centralized validation method (single source of truth)
    const corrected = configManager.validateAndFixModelSelections();

    // Update instance properties with corrected values
    this.#selectedModel = corrected.main;
    this.#miniModel = corrected.mini;
    this.#nanoModel = corrected.nano;

    logger.info('Model selections after validation:', corrected);

    this.#initializeAgentService();

    // Re-initialize MCP based on latest settings
    try {
      await MCPRegistry.init();
      await MCPRegistry.refresh();
    } catch (err) {
      logger.error('Failed to reinitialize MCP after settings change', err);
    }
  }
  
  /**
   * Updates model selections based on updated options
   */
  #updateModelSelections(): void {
    // Get the current provider and its defaults
    const currentProvider = localStorage.getItem(PROVIDER_SELECTION_KEY) || 'openai';
    const providerDefaults = DEFAULT_PROVIDER_MODELS[currentProvider] || DEFAULT_PROVIDER_MODELS.openai;
    
    // Load saved mini/nano models if valid
    const storedMiniModel = localStorage.getItem(MINI_MODEL_STORAGE_KEY);
    const storedNanoModel = localStorage.getItem(NANO_MODEL_STORAGE_KEY);
    
    // Check if mini/nano models are still valid with the new MODEL_OPTIONS AND belong to current provider
    const storedMiniModelOption = storedMiniModel ? MODEL_OPTIONS.find(option => option.value === storedMiniModel) : null;
    if (storedMiniModelOption && storedMiniModelOption.type === currentProvider && storedMiniModel) {
      this.#miniModel = storedMiniModel;
    } else if (providerDefaults.mini && MODEL_OPTIONS.some(option => option.value === providerDefaults.mini)) {
      // Use provider default mini model if available
      this.#miniModel = providerDefaults.mini;
      localStorage.setItem(MINI_MODEL_STORAGE_KEY, this.#miniModel);
    } else {
      this.#miniModel = '';
      localStorage.removeItem(MINI_MODEL_STORAGE_KEY);
    }
    
    const storedNanoModelOption = storedNanoModel ? MODEL_OPTIONS.find(option => option.value === storedNanoModel) : null;
    if (storedNanoModelOption && storedNanoModelOption.type === currentProvider && storedNanoModel) {
      this.#nanoModel = storedNanoModel;
    } else if (providerDefaults.nano && MODEL_OPTIONS.some(option => option.value === providerDefaults.nano)) {
      // Use provider default nano model if available
      this.#nanoModel = providerDefaults.nano;
      localStorage.setItem(NANO_MODEL_STORAGE_KEY, this.#nanoModel);
    } else {
      this.#nanoModel = '';
      localStorage.removeItem(NANO_MODEL_STORAGE_KEY);
    }
    
    // Check if the current selected model is valid for the new provider
    const selectedModelOption = MODEL_OPTIONS.find(opt => opt.value === this.#selectedModel);
    if (!this.#selectedModel || !selectedModelOption || selectedModelOption.type !== currentProvider) {
      logger.info(`Selected model ${this.#selectedModel} is not valid for provider ${currentProvider}, selecting default`);

      // Try to use provider default main model first
      if (providerDefaults.main && MODEL_OPTIONS.some(option => option.value === providerDefaults.main)) {
        this.#selectedModel = providerDefaults.main;
        logger.info(`Set main model to provider default: ${providerDefaults.main}`);
      } else if (MODEL_OPTIONS.length > 0) {
        // Otherwise, use the first available model
        this.#selectedModel = MODEL_OPTIONS[0].value;
        logger.info(`Set main model to first available: ${this.#selectedModel}`);
      } else {
        // No models available
        this.#selectedModel = '';
        logger.warn(`No models available for provider ${currentProvider}`);
      }
      localStorage.setItem(MODEL_SELECTION_KEY, this.#selectedModel);
    }
    
    // Log the updated selections
    logger.info('Updated model selections for provider change:', {
      provider: currentProvider,
      selectedModel: this.#selectedModel,
      miniModel: this.#miniModel,
      nanoModel: this.#nanoModel
    });
    
    // Trigger UI update to reflect the new model selections
    this.performUpdate();
  }

  /**
   * Sets up the panel as a root panel
   */
  override markAsRoot(): void {
    super.markAsRoot();
    // Ensure the content element has appropriate accessibility attributes
    if (this.contentElement) {
      this.contentElement.setAttribute('aria-label', 'AI Chat Panel');
      this.contentElement.setAttribute('role', 'region');
    }
  }
}

export class ActionDelegate implements UI.ActionRegistration.ActionDelegate {
  handleAction(_context: UI.Context.Context, actionId: string): boolean {
    switch (actionId) {
      case 'ai-chat.toggle':
        void UI.ViewManager.ViewManager.instance().showView('ai-chat');
        return true;
    }
    return false;
  }
}
