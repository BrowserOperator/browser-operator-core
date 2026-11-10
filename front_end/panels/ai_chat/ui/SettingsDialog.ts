// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Host from '../../../core/host/host.js';
import * as UI from '../../../ui/legacy/legacy.js';
import { createLogger } from '../core/Logger.js';
import { LLMClient } from '../LLM/LLMClient.js';
import { CustomProviderDialog } from './CustomProviderDialog.js';
import { CustomProviderManager } from '../core/CustomProviderManager.js';

// Import settings utilities
import { i18nString, UIStrings } from './settings/i18n-strings.js';
import { PROVIDER_SELECTION_KEY, MINI_MODEL_STORAGE_KEY, NANO_MODEL_STORAGE_KEY, ADVANCED_SETTINGS_ENABLED_KEY, PANEL_FILTER_ENABLED_KEY } from './settings/constants.js';
import { applySettingsStyles } from './settings/utils/styles.js';
import { isVectorDBEnabled } from './settings/utils/storage.js';
import type { ModelOption, ProviderType, FetchLiteLLMModelsFunction, UpdateModelOptionsFunction, GetModelOptionsFunction, AddCustomModelOptionFunction, RemoveCustomModelOptionFunction } from './settings/types.js';

// Re-export for backward compatibility
export { isVectorDBEnabled };

// Import provider settings classes
import { GenericProviderSettings } from './settings/providers/GenericProviderSettings.js';
import { LiteLLMSettings } from './settings/providers/LiteLLMSettings.js';
import { OpenRouterSettings } from './settings/providers/OpenRouterSettings.js';

// Import provider configurations
import { OpenAIConfig, BrowserOperatorConfig, GroqConfig, CerebrasConfig, AnthropicConfig, GoogleAIConfig } from './settings/providerConfigs.js';

// Import advanced feature settings classes
import { MCPSettings } from './settings/advanced/MCPSettings.js';
import { BrowsingHistorySettings } from './settings/advanced/BrowsingHistorySettings.js';
import { VectorDBSettings } from './settings/advanced/VectorDBSettings.js';
import { TracingSettings } from './settings/advanced/TracingSettings.js';
import { EvaluationSettings } from './settings/advanced/EvaluationSettings.js';
import { MemorySettings } from './settings/advanced/MemorySettings.js';

import './model_selector/ModelSelector.js';

const logger = createLogger('SettingsDialog');

// Provider configuration registry
interface ProviderConfig {
  id: ProviderType;
  i18nKey: keyof typeof UIStrings;
  config?: any;
  settingsClass?: 'generic' | 'litellm' | 'openrouter';
}

const PROVIDER_REGISTRY: ProviderConfig[] = [
  { id: 'openai', i18nKey: 'openaiProvider', config: OpenAIConfig, settingsClass: 'generic' },
  { id: 'litellm', i18nKey: 'litellmProvider', settingsClass: 'litellm' },
  { id: 'groq', i18nKey: 'groqProvider', config: GroqConfig, settingsClass: 'generic' },
  { id: 'openrouter', i18nKey: 'openrouterProvider', settingsClass: 'openrouter' },
  { id: 'browseroperator', i18nKey: 'browseroperatorProvider', config: BrowserOperatorConfig, settingsClass: 'generic' },
  { id: 'cerebras', i18nKey: 'cerebrasProvider', config: CerebrasConfig, settingsClass: 'generic' },
  { id: 'anthropic', i18nKey: 'anthropicProvider', config: AnthropicConfig, settingsClass: 'generic' },
  { id: 'googleai', i18nKey: 'googleaiProvider', config: GoogleAIConfig, settingsClass: 'generic' },
];

export class SettingsDialog {
  static async show(
    selectedModel: string,
    miniModel: string,
    nanoModel: string,
    onSettingsSaved: () => void,
    fetchLiteLLMModels: FetchLiteLLMModelsFunction,
    updateModelOptions: UpdateModelOptionsFunction,
    getModelOptions: GetModelOptionsFunction,
    addCustomModelOption: AddCustomModelOptionFunction,
    removeCustomModelOption: RemoveCustomModelOptionFunction,
  ): Promise<void> {

    // Create a settings dialog
    const dialog = new UI.Dialog.Dialog();
    dialog.setDimmed(true);
    dialog.setOutsideClickCallback(() => dialog.hide());
    dialog.contentElement.classList.add('settings-dialog');

    // Create settings content
    const contentDiv = document.createElement('div');
    contentDiv.className = 'settings-content';
    contentDiv.style.overflowY = 'auto';
    dialog.contentElement.appendChild(contentDiv);

    // Create header
    const headerDiv = document.createElement('div');
    headerDiv.className = 'settings-header';
    contentDiv.appendChild(headerDiv);

    const title = document.createElement('h2');
    title.className = 'settings-title';
    title.textContent = i18nString(UIStrings.settings);
    headerDiv.appendChild(title);

    const closeButton = document.createElement('button');
    closeButton.className = 'settings-close-button';
    closeButton.setAttribute('aria-label', 'Close settings');
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => dialog.hide());
    headerDiv.appendChild(closeButton);

    // Add provider selection dropdown
    const providerSection = document.createElement('div');
    providerSection.className = 'provider-selection-section';
    contentDiv.appendChild(providerSection);

    const providerLabel = document.createElement('div');
    providerLabel.className = 'settings-label';
    providerLabel.textContent = i18nString(UIStrings.providerLabel);
    providerSection.appendChild(providerLabel);

    const providerHint = document.createElement('div');
    providerHint.className = 'settings-hint';
    providerHint.textContent = i18nString(UIStrings.providerHint);
    providerSection.appendChild(providerHint);

    // Use the stored provider from localStorage
    const currentProvider = (localStorage.getItem(PROVIDER_SELECTION_KEY) || 'openai') as ProviderType;

    // Helper function to create ProviderConfig from CustomProviderConfig
    const createCustomProviderConfig = (customConfig: any): any => {
      return {
        id: customConfig.id,
        displayName: customConfig.name,
        apiKeyStorageKey: CustomProviderManager.getApiKeyStorageKey(customConfig.id),
        apiKeyLabel: `${customConfig.name} API Key`,
        apiKeyHint: `API key for ${customConfig.name} (optional)`,
        apiKeyPlaceholder: 'Enter API key (optional)',
        hasModelSelectors: true,
        hasFetchButton: false,
        apiKeyOptional: true
      };
    };

    // Helper function to create model options getter for custom providers
    const createCustomModelOptionsGetter = (providerId: string) => {
      return (_provider?: ProviderType) => {
        const config = CustomProviderManager.getProvider(providerId);
        if (!config) return [];
        return config.models.map(modelId => ({
          value: modelId,
          label: modelId,
          type: providerId
        }));
      };
    };

    // Helper function to initialize custom provider settings
    const initializeCustomProviderSettings = (
      providerId: string,
      container: HTMLElement
    ): GenericProviderSettings | null => {
      const customConfig = CustomProviderManager.getProvider(providerId);
      if (!customConfig) return null;

      const providerConfig = createCustomProviderConfig(customConfig);
      const settings = new GenericProviderSettings(
        container,
        providerConfig,
        createCustomModelOptionsGetter(providerId),
        addCustomModelOption,
        removeCustomModelOption
      );
      settings.render();
      return settings;
    };

    // Helper function to toggle provider content visibility
    const toggleProviderVisibility = (
      selectedProvider: string,
      providerContents: Map<string, HTMLElement>,
      customContent: HTMLElement
    ): void => {
      const isCustom = CustomProviderManager.isCustomProvider(selectedProvider);

      // Hide all provider contents
      providerContents.forEach((content, providerId) => {
        content.style.display = providerId === selectedProvider ? 'block' : 'none';
      });

      // Show/hide custom provider content
      customContent.style.display = isCustom ? 'block' : 'none';
    };

    // Create provider selection dropdown
    const providerSelect = document.createElement('select');
    providerSelect.className = 'settings-select provider-select';
    providerSection.appendChild(providerSelect);

    // Add provider options from registry
    PROVIDER_REGISTRY.forEach(provider => {
      const option = document.createElement('option');
      option.value = provider.id;
      option.textContent = i18nString(UIStrings[provider.i18nKey]);
      option.selected = currentProvider === provider.id;
      providerSelect.appendChild(option);
    });

    // Add custom providers to the dropdown
    const customProviders = CustomProviderManager.listEnabledProviders();
    if (customProviders.length > 0) {
      // Add separator
      const separator = document.createElement('option');
      separator.disabled = true;
      separator.textContent = '──────────';
      providerSelect.appendChild(separator);

      // Add each custom provider
      customProviders.forEach(provider => {
        const customOption = document.createElement('option');
        customOption.value = provider.id;
        customOption.textContent = `${provider.name} (Custom)`;
        customOption.selected = currentProvider === provider.id;
        providerSelect.appendChild(customOption);
      });
    }

    // Ensure the select's value reflects the computed currentProvider
    providerSelect.value = currentProvider;

    // Add "Manage Custom Providers" button
    const manageCustomButton = document.createElement('button');
    manageCustomButton.className = 'settings-button manage-custom-providers-button';
    manageCustomButton.textContent = i18nString(UIStrings.manageCustomProvidersButton);
    manageCustomButton.style.cssText = 'margin-top: 8px; padding: 6px 12px; cursor: pointer;';
    manageCustomButton.addEventListener('click', () => {
      // Create and show custom provider dialog
      const customProviderDialog = new CustomProviderDialog(() => {
        // Refresh the settings dialog to show updated custom providers
        dialog.hide();
        SettingsDialog.show(
          selectedModel,
          miniModel,
          nanoModel,
          onSettingsSaved,
          fetchLiteLLMModels,
          updateModelOptions,
          getModelOptions,
          addCustomModelOption,
          removeCustomModelOption
        );
      });
      customProviderDialog.show();
    });
    providerSection.appendChild(manageCustomButton);

    // Create provider-specific content containers using registry
    const providerContents = new Map<string, HTMLElement>();

    PROVIDER_REGISTRY.forEach(provider => {
      const content = document.createElement('div');
      content.className = `provider-content ${provider.id}-content`;
      content.style.display = currentProvider === provider.id ? 'block' : 'none';
      contentDiv.appendChild(content);
      providerContents.set(provider.id, content);
    });

    // Create custom provider content container
    const customProviderContent = document.createElement('div');
    customProviderContent.className = 'provider-content custom-provider-content';
    customProviderContent.style.display = CustomProviderManager.isCustomProvider(currentProvider) ? 'block' : 'none';
    contentDiv.appendChild(customProviderContent);

    // Variable to hold current custom provider settings instance
    let customProviderSettings: GenericProviderSettings | null = null;

    // Instantiate provider settings classes using registry
    const providerSettings = new Map<ProviderType, any>();

    PROVIDER_REGISTRY.forEach(provider => {
      const content = providerContents.get(provider.id);
      if (!content) return;

      let settings;
      if (provider.settingsClass === 'litellm') {
        settings = new LiteLLMSettings(
          content,
          getModelOptions,
          addCustomModelOption,
          removeCustomModelOption,
          updateModelOptions,
          fetchLiteLLMModels
        );
      } else if (provider.settingsClass === 'openrouter') {
        settings = new OpenRouterSettings(
          content,
          getModelOptions,
          addCustomModelOption,
          removeCustomModelOption,
          updateModelOptions,
          onSettingsSaved,
          () => dialog.hide()
        );
      } else {
        // Generic provider settings
        const hasUpdateModelOptions = ['groq', 'cerebras', 'anthropic', 'googleai'].includes(provider.id);
        settings = new GenericProviderSettings(
          content,
          provider.config!,
          getModelOptions,
          addCustomModelOption,
          removeCustomModelOption,
          hasUpdateModelOptions ? updateModelOptions : undefined
        );
      }

      settings.render();
      providerSettings.set(provider.id, settings);
    });

    // Initialize custom provider settings if current provider is custom
    if (CustomProviderManager.isCustomProvider(currentProvider)) {
      customProviderSettings = initializeCustomProviderSettings(currentProvider, customProviderContent);
    }

    // Provider auto-fetch configuration for generic handling
    interface ProviderAutoFetchConfig {
      fetchMethod: (apiKey: string) => Promise<any[]>;
      storageKey: string;
      hasNameField: boolean;
      cacheConfig?: {
        cacheKey: string;
        timestampKey: string;
      };
    }

    const providerAutoFetchMap: Record<string, ProviderAutoFetchConfig> = {
      groq: {
        fetchMethod: LLMClient.fetchGroqModels,
        storageKey: 'ai_chat_groq_api_key',
        hasNameField: false
      },
      openrouter: {
        fetchMethod: LLMClient.fetchOpenRouterModels,
        storageKey: 'ai_chat_openrouter_api_key',
        hasNameField: true,
        cacheConfig: {
          cacheKey: 'openrouter_models_cache',
          timestampKey: 'openrouter_models_cache_timestamp'
        }
      },
      cerebras: {
        fetchMethod: LLMClient.fetchCerebrasModels,
        storageKey: 'ai_chat_cerebras_api_key',
        hasNameField: false
      },
      anthropic: {
        fetchMethod: LLMClient.fetchAnthropicModels,
        storageKey: 'ai_chat_anthropic_api_key',
        hasNameField: true
      },
      googleai: {
        fetchMethod: LLMClient.fetchGoogleAIModels,
        storageKey: 'ai_chat_googleai_api_key',
        hasNameField: true
      }
    };

    // Event listener for provider change
    providerSelect.addEventListener('change', async () => {
      const selectedProvider = providerSelect.value as ProviderType;

      // Check if it's a custom provider
      const isCustom = CustomProviderManager.isCustomProvider(selectedProvider);

      // Toggle visibility using helper function
      toggleProviderVisibility(selectedProvider, providerContents, customProviderContent);

      // Handle custom provider
      if (isCustom) {
        // Cleanup existing custom provider settings if any
        if (customProviderSettings) {
          customProviderSettings.cleanup();
        }

        // Initialize new custom provider settings
        customProviderSettings = initializeCustomProviderSettings(selectedProvider, customProviderContent);
      }

      // Handle LiteLLM separately (special case with endpoint and hadWildcard)
      if (selectedProvider === 'litellm') {
        const endpoint = localStorage.getItem('ai_chat_litellm_endpoint');
        const liteLLMApiKey = localStorage.getItem('ai_chat_litellm_api_key') || '';

        if (endpoint) {
          try {
            logger.debug('Fetching LiteLLM models after provider change...');
            const { models: litellmModels, hadWildcard } = await fetchLiteLLMModels(liteLLMApiKey, endpoint);
            updateModelOptions(litellmModels, hadWildcard);
            const litellmSettings = providerSettings.get('litellm');
            if (litellmSettings) {
              litellmSettings.updateModelSelectors();
            }
            logger.debug('Successfully refreshed LiteLLM models after provider change');
          } catch (error) {
            logger.error('Failed to fetch LiteLLM models after provider change:', error);
          }
        }
      }
      // Generic handler for other providers
      else if (providerAutoFetchMap[selectedProvider]) {
        const config = providerAutoFetchMap[selectedProvider];
        const apiKey = localStorage.getItem(config.storageKey) || '';

        if (apiKey) {
          try {
            logger.debug(`Fetching ${selectedProvider} models after provider change...`);
            const models = await config.fetchMethod(apiKey);
            const modelOptions: ModelOption[] = models.map(model => ({
              value: model.id,
              label: config.hasNameField ? (model.name || model.id) : model.id,
              type: selectedProvider as any
            }));
            updateModelOptions(modelOptions, false);

            // Handle optional caching (OpenRouter)
            if (config.cacheConfig) {
              localStorage.setItem(config.cacheConfig.cacheKey, JSON.stringify(modelOptions));
              localStorage.setItem(config.cacheConfig.timestampKey, Date.now().toString());
            }

            const settings = providerSettings.get(selectedProvider);
            if (settings) {
              settings.updateModelSelectors();
            }
            logger.debug(`Successfully refreshed ${selectedProvider} models after provider change`);
          } catch (error) {
            logger.error(`Failed to fetch ${selectedProvider} models after provider change:`, error);
          }
        }
      }
    });

    // Create MCP section container
    const mcpSection = document.createElement('div');
    mcpSection.className = 'settings-section mcp-section';
    mcpSection.style.display = 'block';
    contentDiv.appendChild(mcpSection);

    // Instantiate MCP settings
    const mcpSettings = new MCPSettings(
      mcpSection,
      onSettingsSaved,
      () => dialog.hide()
    );
    mcpSettings.render();

    // Create Memory section
    const memorySection = document.createElement('div');
    memorySection.className = 'settings-section memory-section';
    memorySection.style.display = 'block';
    contentDiv.appendChild(memorySection);

    // Instantiate and render Memory settings
    const memorySettings = new MemorySettings(memorySection);
    memorySettings.render();

    // Add Advanced Settings Toggle
    const advancedToggleContainer = document.createElement('div');
    advancedToggleContainer.className = 'advanced-settings-toggle-container';
    contentDiv.appendChild(advancedToggleContainer);

    const advancedToggleCheckbox = document.createElement('input');
    advancedToggleCheckbox.type = 'checkbox';
    advancedToggleCheckbox.id = 'advanced-settings-toggle';
    advancedToggleCheckbox.className = 'advanced-settings-checkbox';
    advancedToggleCheckbox.checked = localStorage.getItem(ADVANCED_SETTINGS_ENABLED_KEY) === 'true';
    advancedToggleContainer.appendChild(advancedToggleCheckbox);

    const advancedToggleLabel = document.createElement('label');
    advancedToggleLabel.htmlFor = 'advanced-settings-toggle';
    advancedToggleLabel.className = 'advanced-settings-label';
    advancedToggleLabel.textContent = '⚙️ Advanced Settings';
    advancedToggleContainer.appendChild(advancedToggleLabel);

    // Create advanced feature sections
    const historySection = document.createElement('div');
    historySection.className = 'settings-section history-section';
    contentDiv.appendChild(historySection);

    const vectorDBSection = document.createElement('div');
    vectorDBSection.className = 'settings-section vector-db-section';
    contentDiv.appendChild(vectorDBSection);

    const tracingSection = document.createElement('div');
    tracingSection.className = 'settings-section tracing-section';
    contentDiv.appendChild(tracingSection);

    const evaluationSection = document.createElement('div');
    evaluationSection.className = 'settings-section evaluation-section';
    contentDiv.appendChild(evaluationSection);

    // Create panel filter section (inside advanced settings)
    const panelFilterSection = document.createElement('div');
    panelFilterSection.className = 'settings-section panel-filter-section';
    contentDiv.appendChild(panelFilterSection);

    const panelFilterTitle = document.createElement('h3');
    panelFilterTitle.className = 'settings-subtitle';
    panelFilterTitle.textContent = 'Panel Visibility';
    panelFilterSection.appendChild(panelFilterTitle);

    const panelFilterContainer = document.createElement('div');
    panelFilterContainer.className = 'settings-checkbox-container';
    panelFilterContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 8px;';
    panelFilterSection.appendChild(panelFilterContainer);

    const panelFilterCheckbox = document.createElement('input');
    panelFilterCheckbox.type = 'checkbox';
    panelFilterCheckbox.id = 'panel-filter-toggle';
    panelFilterCheckbox.checked = localStorage.getItem(PANEL_FILTER_ENABLED_KEY) !== 'false';
    panelFilterContainer.appendChild(panelFilterCheckbox);

    const panelFilterLabel = document.createElement('label');
    panelFilterLabel.htmlFor = 'panel-filter-toggle';
    panelFilterLabel.textContent = 'Show only AI Chat panel';
    panelFilterContainer.appendChild(panelFilterLabel);

    const panelFilterHint = document.createElement('div');
    panelFilterHint.className = 'settings-hint';
    panelFilterHint.textContent = 'When disabled, shows all standard DevTools panels (Elements, Console, etc.). Requires DevTools reload.';
    panelFilterSection.appendChild(panelFilterHint);

    panelFilterCheckbox.addEventListener('change', () => {
      localStorage.setItem(PANEL_FILTER_ENABLED_KEY, panelFilterCheckbox.checked.toString());
      // Reload DevTools to apply the panel filter change
      Host.InspectorFrontendHost.InspectorFrontendHostInstance.reattach(() => window.location.reload());
    });

    // Instantiate advanced feature settings classes
    const browsingHistorySettings = new BrowsingHistorySettings(historySection);
    const vectorDBSettings = new VectorDBSettings(vectorDBSection);
    const tracingSettings = new TracingSettings(tracingSection);
    const evaluationSettings = new EvaluationSettings(evaluationSection);

    // Render advanced features
    browsingHistorySettings.render();
    vectorDBSettings.render();
    tracingSettings.render();
    evaluationSettings.render();

    // Store advanced features for cleanup
    const advancedFeatures = [
      browsingHistorySettings,
      vectorDBSettings,
      tracingSettings,
      evaluationSettings,
    ];

    // Store basic features for cleanup (MCP and Memory are not toggled)
    const basicFeatures = [
      mcpSettings,
      memorySettings,
    ];

    // Advanced Settings Toggle Logic
    function toggleAdvancedSections(show: boolean): void {
      const display = show ? 'block' : 'none';
      historySection.style.display = display;
      vectorDBSection.style.display = display;
      tracingSection.style.display = display;
      evaluationSection.style.display = display;
      panelFilterSection.style.display = display;

      // Save state to localStorage
      localStorage.setItem(ADVANCED_SETTINGS_ENABLED_KEY, show.toString());
    }

    // Set initial state of advanced sections
    toggleAdvancedSections(advancedToggleCheckbox.checked);

    // Add event listener for toggle
    advancedToggleCheckbox.addEventListener('change', () => {
      toggleAdvancedSections(advancedToggleCheckbox.checked);
    });

    // Add disclaimer section
    const disclaimerSection = document.createElement('div');
    disclaimerSection.classList.add('settings-section', 'disclaimer-section');
    contentDiv.appendChild(disclaimerSection);

    const disclaimerTitle = document.createElement('h3');
    disclaimerTitle.textContent = i18nString(UIStrings.importantNotice);
    disclaimerTitle.classList.add('settings-subtitle');
    disclaimerSection.appendChild(disclaimerTitle);

    const disclaimerText = document.createElement('div');
    disclaimerText.classList.add('settings-disclaimer');
    disclaimerText.innerHTML = `
      <p class="disclaimer-warning">
        <strong>Beta Version:</strong> This is a beta version of the Browser Operator - AI Assistant feature.
      </p>
      <p class="disclaimer-note">
        <strong>Data Sharing:</strong> When using this feature, your browser data and conversation content will be sent to the AI model for processing.
      </p>
      <p class="disclaimer-note">
        <strong>Provider Support:</strong> We currently support OpenAI, Groq and OpenRouter providers directly. And we support LiteLLM as a proxy to access 100+ other models.
      </p>
      <p class="disclaimer-footer">
        By using this feature, you acknowledge that your data will be processed according to Model Provider's privacy policy and terms of service.
      </p>
    `;
    disclaimerSection.appendChild(disclaimerText);

    // Create footer with buttons
    const footer = document.createElement('div');
    footer.className = 'settings-footer';
    contentDiv.appendChild(footer);

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'settings-buttons';
    footer.appendChild(buttonContainer);

    const saveStatusMessage = document.createElement('div');
    saveStatusMessage.className = 'settings-status save-status';
    saveStatusMessage.style.display = 'none';
    buttonContainer.appendChild(saveStatusMessage);

    const cancelButton = document.createElement('button');
    cancelButton.textContent = i18nString(UIStrings.cancelButton);
    cancelButton.className = 'settings-button cancel-button';
    cancelButton.setAttribute('type', 'button');
    cancelButton.addEventListener('click', () => dialog.hide());
    buttonContainer.appendChild(cancelButton);

    const saveButton = document.createElement('button');
    saveButton.textContent = i18nString(UIStrings.saveButton);
    saveButton.className = 'settings-button save-button';
    saveButton.setAttribute('type', 'button');
    buttonContainer.appendChild(saveButton);

    saveButton.addEventListener('click', async () => {
      // Disable save button while saving
      saveButton.disabled = true;

      // Show saving status
      saveStatusMessage.textContent = 'Saving settings...';
      saveStatusMessage.style.backgroundColor = 'var(--color-accent-blue-background)';
      saveStatusMessage.style.color = 'var(--color-accent-blue)';
      saveStatusMessage.style.display = 'block';

      // Save provider selection
      const selectedProvider = providerSelect.value;
      localStorage.setItem(PROVIDER_SELECTION_KEY, selectedProvider);

      // Save all provider settings
      providerSettings.forEach(settings => {
        settings.save();
      });

      // Save custom provider settings if active
      if (customProviderSettings) {
        customProviderSettings.save();
      }

      // Get current provider settings (either standard or custom)
      let currentProviderSettings = CustomProviderManager.isCustomProvider(selectedProvider)
        ? customProviderSettings
        : providerSettings.get(selectedProvider as ProviderType);

      if (currentProviderSettings) {
        const miniModelValue = currentProviderSettings.getMiniModel();
        const nanoModelValue = currentProviderSettings.getNanoModel();

        logger.debug('Mini model value to save:', miniModelValue);
        if (miniModelValue) {
          localStorage.setItem(MINI_MODEL_STORAGE_KEY, miniModelValue);
        } else {
          localStorage.removeItem(MINI_MODEL_STORAGE_KEY);
        }

        logger.debug('Nano model value to save:', nanoModelValue);
        if (nanoModelValue) {
          localStorage.setItem(NANO_MODEL_STORAGE_KEY, nanoModelValue);
        } else {
          localStorage.removeItem(NANO_MODEL_STORAGE_KEY);
        }
      }

      // Save all advanced feature settings
      vectorDBSettings.save();
      tracingSettings.save();
      evaluationSettings.save();
      // browsingHistorySettings and mcpSettings don't have save() methods as they auto-save

      logger.debug('Settings saved successfully');
      logger.debug('Mini Model:', localStorage.getItem(MINI_MODEL_STORAGE_KEY));
      logger.debug('Nano Model:', localStorage.getItem(NANO_MODEL_STORAGE_KEY));
      logger.debug('Provider:', selectedProvider);

      // Set success message and notify parent
      saveStatusMessage.textContent = 'Settings saved successfully';
      saveStatusMessage.style.backgroundColor = 'var(--color-accent-green-background)';
      saveStatusMessage.style.color = 'var(--color-accent-green)';
      saveStatusMessage.style.display = 'block';

      onSettingsSaved();

      setTimeout(() => {
        dialog.hide();
      }, 1500);
    });

    // Apply styles
    applySettingsStyles(dialog.contentElement);

    // Show the dialog
    dialog.show();

    // Cleanup when dialog is hidden
    dialog.contentElement.addEventListener('DOMNodeRemovedFromDocument', () => {
      // Cleanup all advanced features that have cleanup methods
      advancedFeatures.forEach(feature => {
        if (feature.cleanup) {
          feature.cleanup();
        }
      });

      // Cleanup basic features (MCP and Memory)
      basicFeatures.forEach(feature => {
        if (feature.cleanup) {
          feature.cleanup();
        }
      });

      // Cleanup all provider settings that have cleanup methods
      providerSettings.forEach(provider => {
        if (provider.cleanup) {
          provider.cleanup();
        }
      });
    });
  }

  /**
   * Static method to update OpenRouter models cache
   * Called from AIChatPanel when OAuth credentials are available
   */
  static updateOpenRouterModels(openrouterModels: Array<{id: string, name?: string}>): void {
    // Convert OpenRouter models to ModelOption format
    const modelOptions: ModelOption[] = openrouterModels.map(model => ({
      value: model.id,
      label: model.name || model.id,
      type: 'openrouter' as const
    }));

    // Store in localStorage with timestamp
    localStorage.setItem('openrouter_models_cache', JSON.stringify(modelOptions));
    localStorage.setItem('openrouter_models_cache_timestamp', Date.now().toString());
  }
}
