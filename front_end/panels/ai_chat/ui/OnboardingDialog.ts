// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as UI from '../../../ui/legacy/legacy.js';
import * as Geometry from '../../../models/geometry/geometry.js';
import { applyOnboardingStyles } from './onboardingStyles.js';
import { LLMProviderRegistry } from '../LLM/LLMProviderRegistry.js';
import { OpenRouterOAuth } from '../auth/OpenRouterOAuth.js';
import { createLogger } from '../core/Logger.js';

const logger = createLogger('OnboardingDialog');

const ONBOARDING_COMPLETE_KEY = 'ai_chat_onboarding_complete';
const SETUP_SKIPPED_KEY = 'ai_chat_setup_skipped';

/**
 * Provider information for the onboarding wizard
 */
interface ProviderInfo {
  id: string;
  name: string;
  description: string;
  getKeyUrl: string;
}

const PROVIDERS: ProviderInfo[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4.1 and latest OpenAI models',
    getKeyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude models with extended thinking',
    getKeyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'googleai',
    name: 'Google AI',
    description: 'Gemini models for multimodal tasks',
    getKeyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'Ultra-fast inference with Groq hardware',
    getKeyUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    description: 'High-performance AI inference',
    getKeyUrl: 'https://cloud.cerebras.ai/',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Access 100+ models with unified API',
    getKeyUrl: 'https://openrouter.ai/keys',
  },
];

/**
 * Feature information for the overview step
 */
interface FeatureInfo {
  title: string;
  description: string;
  icon: string;
}

const FEATURES: FeatureInfo[] = [
  {
    title: 'Multi-Agent Framework',
    description: 'Specialized agents automatically handle different tasks like browsing, extraction, and analysis',
    icon: '🤝',
  },
  {
    title: 'Web Automation',
    description: 'Click, type, navigate, and interact with any webpage through natural language',
    icon: '🌐',
  },
  {
    title: 'Data Extraction',
    description: 'Extract structured data from websites using schemas or natural language descriptions',
    icon: '📊',
  },
  {
    title: 'External Tools (MCP)',
    description: 'Connect external tools and data sources via Model Context Protocol',
    icon: '🔌',
  },
  {
    title: 'Conversation History',
    description: 'Your conversations persist between sessions for easy reference',
    icon: '💬',
  },
];

type OnboardingStep = 'welcome' | 'provider' | 'apikey' | 'features' | 'ready';

const STEPS: OnboardingStep[] = ['welcome', 'provider', 'apikey', 'features', 'ready'];

/**
 * Onboarding wizard dialog for first-time users
 */
export class OnboardingDialog {
  private dialog: UI.Dialog.Dialog | null = null;
  private currentStep: OnboardingStep = 'welcome';
  private selectedProvider: ProviderInfo | null = null;
  private apiKey: string = '';
  private onComplete: (() => void) | null = null;

  // DOM elements
  private contentElement: HTMLElement | null = null;
  private stepIndicators: HTMLElement[] = [];
  private apiKeyStatusDiv: HTMLElement | null = null;
  private backButton: HTMLButtonElement | null = null;
  private nextButton: HTMLButtonElement | null = null;
  private skipButton: HTMLButtonElement | null = null;

  // OAuth event handler for cleanup
  private handleOAuthSuccess: (() => void) | null = null;

  /**
   * Check if onboarding should be shown
   */
  static shouldShowOnboarding(): boolean {
    return localStorage.getItem(ONBOARDING_COMPLETE_KEY) !== 'true';
  }

  /**
   * Check if user skipped setup (for showing banner)
   */
  static wasSetupSkipped(): boolean {
    return localStorage.getItem(SETUP_SKIPPED_KEY) === 'true';
  }

  /**
   * Clear the skipped flag (when user completes setup)
   */
  static clearSkippedFlag(): void {
    localStorage.removeItem(SETUP_SKIPPED_KEY);
  }

  /**
   * Show the onboarding dialog
   */
  static show(onComplete?: () => void): void {
    const instance = new OnboardingDialog();
    instance.onComplete = onComplete || null;
    instance.showDialog();
  }

  private showDialog(): void {
    this.dialog = new UI.Dialog.Dialog();
    this.dialog.setDimmed(true);
    this.dialog.setSizeBehavior(UI.GlassPane.SizeBehavior.SET_EXACT_SIZE);
    this.dialog.setMaxContentSize(new Geometry.Size(window.innerWidth, window.innerHeight));

    const container = document.createElement('div');
    container.className = 'onboarding-dialog';
    this.dialog.contentElement.appendChild(container);

    applyOnboardingStyles(container);
    this.buildDialog(container);

    // Setup OAuth success listener for OpenRouter
    this.handleOAuthSuccess = () => {
      logger.info('OAuth success received, completing onboarding');
      this.complete();
    };
    window.addEventListener('openrouter-oauth-success', this.handleOAuthSuccess);

    this.dialog.show();
  }

  private buildDialog(container: HTMLElement): void {
    const dialogContainer = document.createElement('div');
    dialogContainer.className = 'onboarding-container';
    container.appendChild(dialogContainer);

    // Step indicators
    const indicatorsContainer = document.createElement('div');
    indicatorsContainer.className = 'step-indicators';
    dialogContainer.appendChild(indicatorsContainer);

    this.stepIndicators = [];
    for (let i = 0; i < STEPS.length; i++) {
      const indicator = document.createElement('div');
      indicator.className = 'step-indicator';
      indicatorsContainer.appendChild(indicator);
      this.stepIndicators.push(indicator);
    }

    // Content area
    this.contentElement = document.createElement('div');
    this.contentElement.className = 'onboarding-content';
    dialogContainer.appendChild(this.contentElement);

    // Footer
    const footer = document.createElement('div');
    footer.className = 'onboarding-footer';
    dialogContainer.appendChild(footer);

    const footerLeft = document.createElement('div');
    footerLeft.className = 'footer-left';
    footer.appendChild(footerLeft);

    const footerRight = document.createElement('div');
    footerRight.className = 'footer-right';
    footer.appendChild(footerRight);

    // Back button
    const backButton = document.createElement('button');
    backButton.className = 'btn btn-secondary';
    backButton.textContent = 'Back';
    backButton.style.display = 'none';
    backButton.addEventListener('click', () => this.goBack());
    footerLeft.appendChild(backButton);

    // Next/Done button
    const nextButton = document.createElement('button');
    nextButton.className = 'btn btn-primary';
    nextButton.textContent = 'Get Started';
    nextButton.addEventListener('click', () => this.goNext());
    footerRight.appendChild(nextButton);

    // Skip button (in footer, shown on all steps except ready)
    const skipButton = document.createElement('button');
    skipButton.className = 'btn btn-text';
    skipButton.textContent = 'Skip';
    skipButton.addEventListener('click', () => this.skipSetup());
    footerLeft.appendChild(skipButton);

    // Store references
    this.backButton = backButton;
    this.nextButton = nextButton;
    this.skipButton = skipButton;

    this.renderCurrentStep();
  }

  private updateStepIndicators(): void {
    const currentIndex = STEPS.indexOf(this.currentStep);
    this.stepIndicators.forEach((indicator, index) => {
      indicator.classList.remove('active', 'completed');
      if (index < currentIndex) {
        indicator.classList.add('completed');
      } else if (index === currentIndex) {
        indicator.classList.add('active');
      }
    });
  }

  private updateButtons(): void {
    if (!this.backButton || !this.nextButton || !this.skipButton) {
      return;
    }

    // Show/hide back button
    this.backButton.style.display = this.currentStep === 'welcome' ? 'none' : 'block';

    // Show/hide skip button (hide on ready step)
    this.skipButton.style.display = this.currentStep === 'ready' ? 'none' : 'block';

    // Update next button text
    switch (this.currentStep) {
      case 'welcome':
        this.nextButton.textContent = 'Get Started';
        this.nextButton.disabled = false;
        break;
      case 'provider':
        this.nextButton.textContent = 'Next';
        this.nextButton.disabled = !this.selectedProvider;
        break;
      case 'apikey':
        this.nextButton.textContent = 'Next';
        this.nextButton.disabled = false; // Can skip
        break;
      case 'features':
        this.nextButton.textContent = 'Next';
        this.nextButton.disabled = false;
        break;
      case 'ready':
        this.nextButton.textContent = 'Start Chatting';
        this.nextButton.disabled = false;
        break;
    }
  }

  private renderCurrentStep(): void {
    if (!this.contentElement) return;
    this.contentElement.innerHTML = '';
    this.updateStepIndicators();
    this.updateButtons();

    switch (this.currentStep) {
      case 'welcome':
        this.renderWelcomeStep();
        break;
      case 'provider':
        this.renderProviderStep();
        break;
      case 'apikey':
        this.renderApiKeyStep();
        break;
      case 'features':
        this.renderFeaturesStep();
        break;
      case 'ready':
        this.renderReadyStep();
        break;
    }
  }

  private renderWelcomeStep(): void {
    const content = this.contentElement!;

    // Browser Operator logo
    const logoContainer = document.createElement('div');
    logoContainer.className = 'welcome-icon';
    const logo = document.createElement('img');
    logo.src = '/bundled/Images/browser-operator-logo.png';
    logo.alt = 'Browser Operator';
    logo.style.cssText = 'width: 64px; height: 64px; border-radius: 12px;';
    logoContainer.appendChild(logo);
    content.appendChild(logoContainer);

    const title = document.createElement('h2');
    title.className = 'step-title';
    title.textContent = 'Welcome to Browser Operator';
    content.appendChild(title);

    const description = document.createElement('p');
    description.className = 'step-description';
    description.textContent = 'Your intelligent partner for research, analysis, and automation.';
    content.appendChild(description);

    // Demo gif with link to docs
    const demoContainer = document.createElement('div');
    demoContainer.className = 'video-placeholder';
    demoContainer.style.cssText = 'border: none; background: transparent; display: flex; flex-direction: column; align-items: center;';

    // Wrap gif in clickable link
    const gifLink = document.createElement('a');
    gifLink.href = 'https://docs.browseroperator.io/getting-started/';
    gifLink.target = '_top';
    gifLink.className = 'demo-gif-link';

    const demoGif = document.createElement('img');
    demoGif.src = '/bundled/Images/demo.gif';
    demoGif.alt = 'Browser Operator Demo - Click to view getting started guide';
    demoGif.className = 'demo-gif';
    gifLink.appendChild(demoGif);
    demoContainer.appendChild(gifLink);

    const clickLink = document.createElement('a');
    clickLink.href = 'https://docs.browseroperator.io/getting-started/';
    clickLink.target = '_top';
    clickLink.textContent = 'View the getting started guide →';
    clickLink.className = 'getting-started-link';
    demoContainer.appendChild(clickLink);

    content.appendChild(demoContainer);
  }

  private renderProviderStep(): void {
    const content = this.contentElement!;

    const title = document.createElement('h2');
    title.className = 'step-title';
    title.textContent = 'Choose Your AI Provider';
    content.appendChild(title);

    const description = document.createElement('p');
    description.className = 'step-description';
    description.textContent = 'Select the AI provider you\'d like to use. You can change this later in Settings.';
    content.appendChild(description);

    const grid = document.createElement('div');
    grid.className = 'provider-grid';
    content.appendChild(grid);

    for (const provider of PROVIDERS) {
      const card = document.createElement('div');
      card.className = 'provider-card';
      if (this.selectedProvider?.id === provider.id) {
        card.classList.add('selected');
      }

      card.addEventListener('click', () => {
        this.selectedProvider = provider;
        // Update selection visually
        grid.querySelectorAll('.provider-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        // Auto-advance to next step
        this.goNext();
      });

      const header = document.createElement('div');
      header.className = 'provider-card-header';

      const name = document.createElement('span');
      name.className = 'provider-name';
      name.textContent = provider.name;
      header.appendChild(name);

      card.appendChild(header);

      const desc = document.createElement('div');
      desc.className = 'provider-description';
      desc.textContent = provider.description;
      card.appendChild(desc);

      grid.appendChild(card);
    }
  }

  private renderApiKeyStep(): void {
    const content = this.contentElement!;
    const provider = this.selectedProvider!;

    const title = document.createElement('h2');
    title.className = 'step-title';
    title.textContent = `Set Up ${provider.name}`;
    content.appendChild(title);

    const description = document.createElement('p');
    description.className = 'step-description';

    // OpenRouter: OAuth only (no API key input)
    if (provider.id === 'openrouter') {
      description.textContent = 'Sign in with your OpenRouter account to get started.';
      content.appendChild(description);

      const oauthButton = document.createElement('button');
      oauthButton.className = 'btn btn-openrouter';
      oauthButton.textContent = 'Sign in with OpenRouter';
      oauthButton.addEventListener('click', async () => {
        oauthButton.disabled = true;
        oauthButton.textContent = 'Redirecting to OpenRouter...';
        try {
          await OpenRouterOAuth.startAuthFlow();
          // Success is handled by the event listener in showDialog
        } catch (error) {
          oauthButton.disabled = false;
          oauthButton.textContent = 'Sign in with OpenRouter';
          logger.error('OpenRouter OAuth failed:', error);
        }
      });
      content.appendChild(oauthButton);

      // Link to getting started guide (for OpenRouter too)
      const guideLink = document.createElement('a');
      guideLink.href = 'https://docs.browseroperator.io/getting-started/';
      guideLink.target = '_top';
      guideLink.textContent = 'View the getting started guide →';
      guideLink.style.cssText = 'display: block; margin-top: 24px; color: var(--color-primary); text-decoration: none; font-size: 13px; text-align: center;';
      guideLink.addEventListener('mouseenter', () => { guideLink.style.textDecoration = 'underline'; });
      guideLink.addEventListener('mouseleave', () => { guideLink.style.textDecoration = 'none'; });
      content.appendChild(guideLink);

      return; // Don't show API key form for OpenRouter
    }

    // Other providers: show API key form
    description.textContent = `Enter your ${provider.name} API key to get started. Your key is stored locally and never sent to our servers.`;
    content.appendChild(description);

    const form = document.createElement('div');
    form.className = 'api-key-form';
    content.appendChild(form);

    // API Key input
    const formGroup = document.createElement('div');
    formGroup.className = 'form-group';
    form.appendChild(formGroup);

    const label = document.createElement('label');
    label.className = 'form-label';
    label.textContent = 'API Key';
    formGroup.appendChild(label);

    const input = document.createElement('input');
    input.className = 'form-input';
    input.type = 'password';
    input.placeholder = 'Enter your API key';
    input.value = this.apiKey;
    input.addEventListener('input', (e) => {
      this.apiKey = (e.target as HTMLInputElement).value;
    });
    formGroup.appendChild(input);

    const hint = document.createElement('div');
    hint.className = 'form-hint';
    hint.innerHTML = `Don't have an API key? <a href="${provider.getKeyUrl}">Get one here</a>`;
    formGroup.appendChild(hint);

    // Test button
    const testButton = document.createElement('button');
    testButton.className = 'test-button';
    testButton.textContent = 'Test Connection';
    testButton.addEventListener('click', () => this.testConnection(testButton, statusDiv));
    form.appendChild(testButton);

    // Status message (also used for inline errors from goNext)
    const statusDiv = document.createElement('div');
    statusDiv.className = 'test-status';
    form.appendChild(statusDiv);
    this.apiKeyStatusDiv = statusDiv;

    // Link to getting started guide
    const guideLink = document.createElement('a');
    guideLink.href = 'https://docs.browseroperator.io/getting-started/';
    guideLink.target = '_top';
    guideLink.textContent = 'View the getting started guide →';
    guideLink.style.cssText = 'display: block; margin-top: 24px; color: var(--color-primary); text-decoration: none; font-size: 13px; text-align: center;';
    guideLink.addEventListener('mouseenter', () => { guideLink.style.textDecoration = 'underline'; });
    guideLink.addEventListener('mouseleave', () => { guideLink.style.textDecoration = 'none'; });
    content.appendChild(guideLink);
  }

  private async testConnection(button: HTMLButtonElement, statusDiv: HTMLElement): Promise<void> {
    if (!this.apiKey.trim()) {
      statusDiv.className = 'test-status visible error';
      statusDiv.textContent = 'Please enter an API key';
      return;
    }

    button.disabled = true;
    button.textContent = 'Testing...';
    statusDiv.className = 'test-status';

    try {
      const provider = this.selectedProvider!;

      // Use testProviderConnection which creates a fresh provider instance with the API key
      const result = await LLMProviderRegistry.testProviderConnection(
        provider.id as any,
        this.apiKey
      );

      if (!result.success) {
        throw new Error(result.message);
      }

      statusDiv.className = 'test-status visible success';
      statusDiv.textContent = 'Connection successful! Your API key is valid.';
      logger.info(`API key validated for ${provider.id}`);
    } catch (error) {
      statusDiv.className = 'test-status visible error';
      statusDiv.textContent = `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      logger.error('API key validation failed:', error);
    } finally {
      button.disabled = false;
      button.textContent = 'Test Connection';
    }
  }

  private renderFeaturesStep(): void {
    const content = this.contentElement!;

    const title = document.createElement('h2');
    title.className = 'step-title';
    title.textContent = 'What You Can Do';
    content.appendChild(title);

    const description = document.createElement('p');
    description.className = 'step-description';
    description.textContent = 'Browser Operator Agent comes packed with powerful features to help you with daily tasks from the web.';
    content.appendChild(description);

    const list = document.createElement('div');
    list.className = 'feature-list';
    content.appendChild(list);

    for (const feature of FEATURES) {
      const item = document.createElement('div');
      item.className = 'feature-item';

      const icon = document.createElement('span');
      icon.className = 'feature-icon';
      icon.textContent = feature.icon;
      item.appendChild(icon);

      const contentDiv = document.createElement('div');
      contentDiv.className = 'feature-content';

      const featureTitle = document.createElement('h4');
      featureTitle.className = 'feature-title';
      featureTitle.textContent = feature.title;
      contentDiv.appendChild(featureTitle);

      const featureDesc = document.createElement('p');
      featureDesc.className = 'feature-description';
      featureDesc.textContent = feature.description;
      contentDiv.appendChild(featureDesc);

      item.appendChild(contentDiv);
      list.appendChild(item);
    }
  }

  private renderReadyStep(): void {
    const content = this.contentElement!;

    const icon = document.createElement('div');
    icon.className = 'ready-icon';
    icon.textContent = '🎉';
    content.appendChild(icon);

    const title = document.createElement('h2');
    title.className = 'step-title';
    title.textContent = 'You\'re All Set!';
    content.appendChild(title);

    const description = document.createElement('p');
    description.className = 'step-description';
    description.textContent = 'You\'re ready to start using Browser Operator. Here are some quick tips to get you started:';
    content.appendChild(description);

    const tipsList = document.createElement('div');
    tipsList.className = 'tips-list';
    content.appendChild(tipsList);

    const tips = [
      { icon: '💡', text: 'Type naturally - describe what you want to do' },
      { icon: '⚙️', text: 'Click the gear icon for advanced settings' },
      { icon: '🔧', text: 'Configure MCP to add external tools' },
      { icon: '📜', text: 'Your conversation history is saved automatically' },
    ];

    for (const tip of tips) {
      const item = document.createElement('div');
      item.className = 'tip-item';

      const tipIcon = document.createElement('span');
      tipIcon.className = 'tip-icon';
      tipIcon.textContent = tip.icon;
      item.appendChild(tipIcon);

      const tipText = document.createElement('span');
      tipText.textContent = tip.text;
      item.appendChild(tipText);

      tipsList.appendChild(item);
    }
  }

  private goBack(): void {
    const currentIndex = STEPS.indexOf(this.currentStep);
    if (currentIndex > 0) {
      this.currentStep = STEPS[currentIndex - 1];
      this.renderCurrentStep();
    }
  }

  private async goNext(): Promise<void> {
    const currentIndex = STEPS.indexOf(this.currentStep);

    // Validation for provider step
    if (this.currentStep === 'provider' && !this.selectedProvider) {
      return;
    }

    // Require and test API key before advancing from apikey step (non-OpenRouter)
    if (this.currentStep === 'apikey' && this.selectedProvider && this.selectedProvider.id !== 'openrouter') {
      const statusDiv = this.apiKeyStatusDiv;

      // Require API key
      if (!this.apiKey.trim()) {
        if (statusDiv) {
          statusDiv.className = 'test-status visible error';
          statusDiv.textContent = 'Please enter an API key';
          setTimeout(() => {
            statusDiv.className = 'test-status';
            statusDiv.textContent = '';
          }, 5000);
        }
        return;
      }

      if (!this.nextButton) {
        return;
      }
      this.nextButton.disabled = true;
      this.nextButton.textContent = 'Testing...';

      // Clear any previous error
      if (statusDiv) {
        statusDiv.className = 'test-status';
        statusDiv.textContent = '';
      }

      try {
        const provider = this.selectedProvider;

        // Use LLMProviderRegistry.testProviderConnection which works for all providers
        const result = await LLMProviderRegistry.testProviderConnection(
          provider.id as any,
          this.apiKey
        );

        if (!result.success) {
          throw new Error(result.message);
        }

        // Success - save API key and configuration
        LLMProviderRegistry.saveProviderApiKey(provider.id as any, this.apiKey);
        this.saveConfiguration();
        logger.info(`API key validated for ${provider.id}`);

        // Show success screen and auto-close after 5 seconds
        this.showSuccessAndClose();
        return;
      } catch (error) {
        // Failed - show inline error, don't advance
        this.nextButton.disabled = false;
        this.nextButton.textContent = 'Next';
        const errorMsg = error instanceof Error ? error.message : 'Connection failed';
        logger.error('API key validation failed:', error);
        if (statusDiv) {
          statusDiv.className = 'test-status visible error';
          statusDiv.textContent = `Invalid API key: ${errorMsg}`;
          setTimeout(() => {
            statusDiv.className = 'test-status';
            statusDiv.textContent = '';
          }, 5000);
        }
        return;
      }
    }

    if (currentIndex < STEPS.length - 1) {
      this.currentStep = STEPS[currentIndex + 1];
      this.renderCurrentStep();
    } else {
      // Complete onboarding
      this.complete();
    }
  }

  private skipSetup(): void {
    // Mark as skipped
    localStorage.setItem(SETUP_SKIPPED_KEY, 'true');
    // Complete onboarding immediately
    this.complete();
  }

  private showSuccessAndClose(): void {
    // Jump to ready step to show the existing UI
    this.currentStep = 'ready';
    this.renderCurrentStep();

    // Hide footer buttons
    const footer = this.contentElement?.parentElement?.querySelector('.onboarding-footer') as HTMLElement;
    if (footer) {
      footer.style.display = 'none';
    }

    // Add auto-close progress indicator to content
    const content = this.contentElement!;
    const loadingDiv = document.createElement('div');
    loadingDiv.style.cssText = 'margin-top: 24px; text-align: center;';

    // Progress bar container
    const progressContainer = document.createElement('div');
    progressContainer.className = 'auto-close-progress';
    loadingDiv.appendChild(progressContainer);

    // Animated progress bar
    const progressBar = document.createElement('div');
    progressBar.className = 'auto-close-progress-bar';
    progressContainer.appendChild(progressBar);

    // Text below progress
    const progressText = document.createElement('div');
    progressText.className = 'auto-close-text';
    progressText.textContent = 'Starting Browser Operator Agent...';
    loadingDiv.appendChild(progressText);

    content.appendChild(loadingDiv);

    // Auto-close after 5 seconds
    setTimeout(() => {
      this.complete();
    }, 5000);
  }

  private saveConfiguration(): void {
    if (!this.selectedProvider || !this.apiKey.trim()) return;

    const provider = this.selectedProvider;

    // Save provider selection
    localStorage.setItem('ai_chat_provider', provider.id);

    // Save API key
    LLMProviderRegistry.saveProviderApiKey(provider.id as any, this.apiKey);

    logger.info(`Saved configuration for provider: ${provider.id}`);
  }

  private complete(): void {
    // Mark onboarding as complete
    localStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');

    // Clear skipped flag if they completed with an API key
    if (this.apiKey.trim()) {
      localStorage.removeItem(SETUP_SKIPPED_KEY);
    }

    // Clean up OAuth listener
    if (this.handleOAuthSuccess) {
      window.removeEventListener('openrouter-oauth-success', this.handleOAuthSuccess);
      this.handleOAuthSuccess = null;
    }

    // Close dialog
    if (this.dialog) {
      this.dialog.hide();
      this.dialog = null;
    }

    // Call completion callback
    if (this.onComplete) {
      this.onComplete();
    }

    logger.info('Onboarding completed');
  }
}

/**
 * Create and return a setup required banner element
 */
export function createSetupRequiredBanner(onSettingsClick: () => void): HTMLElement {
  const banner = document.createElement('div');
  banner.className = 'setup-required-banner';

  const text = document.createElement('div');
  text.className = 'setup-banner-text';
  text.innerHTML = '⚠️ API key not configured. Set up a provider to start chatting.';
  banner.appendChild(text);

  const button = document.createElement('button');
  button.className = 'setup-banner-button';
  button.textContent = 'Open Settings';
  button.addEventListener('click', onSettingsClick);
  banner.appendChild(button);

  return banner;
}
