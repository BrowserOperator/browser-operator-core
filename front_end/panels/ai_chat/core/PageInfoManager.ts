// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from './Logger.js';

const logger = createLogger('PageInfoManager');

// Detect if we're in a Node.js environment (eval runner, tests)
const isNodeEnvironment = typeof window === 'undefined' || typeof document === 'undefined';

// Dynamic imports for browser-only dependencies (SDK, etc.)
// These are only loaded when needed and only in browser context
let SDK: typeof import('../../../core/sdk/sdk.js') | null = null;
let Utils: typeof import('../common/utils.js') | null = null;
let VisitHistoryManager: typeof import('../tools/VisitHistoryManager.js').VisitHistoryManager | null = null;
let FileStorageManager: typeof import('../tools/FileStorageManager.js').FileStorageManager | null = null;
let MemoryBlockManager: typeof import('../memory/index.js').MemoryBlockManager | null = null;
let injectShadowPiercer: typeof import('../dom/ShadowPiercer.js').injectShadowPiercer | null = null;

// Initialize browser-only dependencies
async function initializeBrowserDependencies(): Promise<boolean> {
  if (isNodeEnvironment) {
    logger.debug('Skipping browser dependencies in Node environment');
    return false;
  }

  try {
    const [sdkModule, utilsModule, visitHistoryModule, fileStorageModule, memoryModule, shadowPiercerModule] = await Promise.all([
      import('../../../core/sdk/sdk.js'),
      import('../common/utils.js'),
      import('../tools/VisitHistoryManager.js'),
      import('../tools/FileStorageManager.js'),
      import('../memory/index.js'),
      import('../dom/ShadowPiercer.js'),
    ]);

    SDK = sdkModule;
    Utils = utilsModule;
    VisitHistoryManager = visitHistoryModule.VisitHistoryManager;
    FileStorageManager = fileStorageModule.FileStorageManager;
    MemoryBlockManager = memoryModule.MemoryBlockManager;
    injectShadowPiercer = shadowPiercerModule.injectShadowPiercer;

    logger.debug('Browser dependencies loaded successfully');
    return true;
  } catch (error) {
    logger.warn('Failed to load browser dependencies:', error);
    return false;
  }
}

// Flag to track if we've tried to initialize
let browserDepsInitialized = false;
let browserDepsAvailable = false;

// Add PageInfoManager class after imports but before other code
export class PageInfoManager {
  private static instance: PageInfoManager;
  private currentInfo: { url: string, title: string } | null = null;
  private accessibilityTree: string | null = null;
  private iframeContent: Array<{ role: string, name?: string, contentSimplified?: string }> | null = null;
  private listeners = new Set<(info: { url: string, title: string } | null) => void>();
  private initialized = false;

  static getInstance(): PageInfoManager {
    if (!PageInfoManager.instance) {
      PageInfoManager.instance = new PageInfoManager();
    }
    return PageInfoManager.instance;
  }

  private constructor() {
    // Defer initialization to async method
    // Browser-specific setup will happen in ensureInitialized()
  }

  /**
   * Ensures browser dependencies are loaded and SDK listeners are set up.
   * Safe to call multiple times - only initializes once.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // Skip browser initialization in Node environment
    if (isNodeEnvironment) {
      logger.debug('PageInfoManager running in Node environment - SDK features disabled');
      return;
    }

    // Load browser dependencies if not already loaded
    if (!browserDepsInitialized) {
      browserDepsInitialized = true;
      browserDepsAvailable = await initializeBrowserDependencies();
    }

    if (!browserDepsAvailable || !SDK) {
      logger.debug('Browser dependencies not available');
      return;
    }

    // Set up navigation event listeners
    if (!SDK) {
      logger.warn('SDK not loaded, skipping target observation');
      return;
    }
    SDK.TargetManager.TargetManager.instance().observeTargets({
      targetAdded: (target) => {
        if (SDK && target.type() === SDK.Target.Type.FRAME) {
          this.updatePageInfo();
          // Inject shadow piercer for shadow DOM access
          this.injectShadowPiercerForTarget(target);
        }
      },
      targetRemoved: () => { }
    });

    // Listen for target info changed events (includes navigation)
    SDK.TargetManager.TargetManager.instance().addEventListener(
      SDK.TargetManager.Events.INSPECTED_URL_CHANGED,
      () => {
        this.updatePageInfo();
        // Re-inject shadow piercer after navigation
        const target = SDK?.TargetManager.TargetManager.instance().primaryPageTarget();
        if (target) {
          this.injectShadowPiercerForTarget(target);
        }
      }
    );

    // Initialize with current info and inject shadow piercer
    this.updatePageInfo();
    const initialTarget = SDK.TargetManager.TargetManager.instance().primaryPageTarget();
    if (initialTarget) {
      this.injectShadowPiercerForTarget(initialTarget);
    }
  }

  /**
   * Injects the shadow piercer runtime script into a target for shadow DOM access.
   * The piercer patches Element.attachShadow to capture closed shadow roots.
   */
  private async injectShadowPiercerForTarget(target: any): Promise<void> {
    if (!injectShadowPiercer) {
      return;
    }
    try {
      await injectShadowPiercer(target);
      logger.debug('Shadow piercer injected for target:', target.id());
    } catch (error) {
      logger.warn('Failed to inject shadow piercer:', error);
    }
  }

  /**
   * Updates page information and fetches the latest accessibility tree
   * This method is used to explicitly refresh the data before each agent iteration
   */
  async updatePageInfoWithFullTree(): Promise<void> {
    await this.ensureInitialized();

    // In Node environment, just return - page context comes from cdpAdapter
    if (isNodeEnvironment || !SDK) {
      return;
    }

    const target = SDK.TargetManager.TargetManager.instance().primaryPageTarget();
    if (!target) {
      this.setInfo(null);
      return;
    }

    try {
      // First update basic page info
      const result = await target.runtimeAgent().invoke_evaluate({
        expression: '({ url: window.location.href, title: document.title })',
        returnByValue: true,
      });

      if (result.result?.value) {
        const pageInfo = result.result.value as { url: string, title: string };
        this.setInfo(pageInfo);

        // Remove storeVisit call from here - we'll store after accessibility tree is loaded
      }

      // Then, fetch the latest accessibility tree
      await this.fetchAccessibilityTree(target);

      logger.debug('Updated page info and accessibility tree');
    } catch (error) {
      logger.error('Error updating page info with full tree:', error);
    }
  }

  private async updatePageInfo(): Promise<void> {
    // Skip in Node environment
    if (isNodeEnvironment || !SDK) {
      return;
    }

    try {
      const target = SDK.TargetManager.TargetManager.instance().primaryPageTarget();
      if (!target) {
        this.setInfo(null);
        return;
      }

      const result = await target.runtimeAgent().invoke_evaluate({
        expression: '({ url: window.location.href, title: document.title })',
        returnByValue: true,
      });

      if (result.result?.value) {
        const pageInfo = result.result.value as { url: string, title: string };
        this.setInfo(pageInfo);

        // Remove storeVisit call from here - we'll only store after accessibility tree is loaded
      } else {
        this.setInfo(null);
      }
    } catch (error) {
      logger.error('Error updating page info:', error);
      this.setInfo(null);
    }
  }

  private async fetchAccessibilityTree(target: any): Promise<void> {
    // Skip if Utils not available (Node environment)
    if (!Utils) {
      return;
    }

    try {
      // Call the getVisibleAccessibilityTree function from Utils
      const treeResult = await Utils.getVisibleAccessibilityTree(target);

      // Store the simplified tree
      this.accessibilityTree = treeResult.simplified;

      // Store information about iframes - create an additional property
      this.iframeContent = treeResult.iframes
        .filter(iframe => iframe.contentSimplified)
        .map(iframe => ({
          role: iframe.role,
          name: iframe.name,
          contentSimplified: iframe.contentSimplified
        }));

      logger.debug('Accessibility tree updated:', this.accessibilityTree?.substring(0, 100) + '...');
      if (this.iframeContent?.length) {
        logger.debug(`Found ${this.iframeContent.length} iframes with content`);
      }

      // Keep this storeVisit call - it has the most complete data (page info + accessibility tree)
      const pageInfo = this.getCurrentInfo();
      if (pageInfo?.url && VisitHistoryManager) {
        // Store with the accessibility tree
        VisitHistoryManager.getInstance().storeVisit(pageInfo, this.accessibilityTree);
      }
    } catch (error) {
      logger.error('Error fetching accessibility tree:', error);
      this.accessibilityTree = null;
      this.iframeContent = [];
    }
  }

  private setInfo(info: { url: string, title: string } | null): void {
    const oldInfo = this.currentInfo;
    const isDifferent = !oldInfo || !info || oldInfo.url !== info.url || oldInfo.title !== info.title;

    if (isDifferent) {
      logger.debug('Page info updated:', info);
      this.currentInfo = info;
      // Notify all listeners
      this.listeners.forEach(listener => listener(info));
    }
  }

  getCurrentInfo(): { url: string, title: string } | null {
    return this.currentInfo;
  }

  getAccessibilityTree(): string | null {
    return this.accessibilityTree;
  }

  getIframeContent(): Array<{ role: string, name?: string, contentSimplified?: string }> | null {
    return this.iframeContent;
  }

  addListener(listener: (info: { url: string, title: string } | null) => void): () => void {
    this.listeners.add(listener);
    // Return unsubscribe function
    return () => this.listeners.delete(listener);
  }
}

// Initialize PageInfoManager
PageInfoManager.getInstance();

/**
 * Enhances a system prompt with current page context information
 * @param basePrompt The original system prompt to enhance
 * @returns The enhanced system prompt with page context information if available
 */
export async function enhancePromptWithPageContext(basePrompt: string): Promise<string> {
  // In Node environment, just return the base prompt - context comes from cdpAdapter
  if (isNodeEnvironment) {
    return basePrompt;
  }

  // Fetch the latest accessibility tree before generating the prompt
  await PageInfoManager.getInstance().updatePageInfoWithFullTree();

  // Get current page info from the manager
  const pageInfo = PageInfoManager.getInstance().getCurrentInfo();
  const accessibilityTree = PageInfoManager.getInstance().getAccessibilityTree();
  const iframeContent = PageInfoManager.getInstance().getIframeContent();

  // Get current session files (only if FileStorageManager is available)
  let files: any[] = [];
  if (FileStorageManager) {
    try {
      const fileManager = FileStorageManager.getInstance();
      files = await fileManager.listFiles();
    } catch (error) {
      logger.warn('Failed to fetch files for context:', error);
    }
  }

  // Get memory context (global across sessions) - only if MemoryBlockManager is available
  let memoryContext = '';
  if (MemoryBlockManager) {
    try {
      const memoryManager = new MemoryBlockManager();
      memoryContext = await memoryManager.compileMemoryContext();
    } catch (error) {
      logger.warn('Failed to fetch memory context:', error);
    }
  }

  // If no page info is available, return the original prompt
  if (!pageInfo) {
    return basePrompt;
  }

  // TODO: Move out of the system prompt and into a separate context prompt
  // TODO: Add guardrails to protect user privacy and security
  // Add current page context with improved structure and instructions
  return `${basePrompt}

<Context>
  <User>
    <Date>${new Date().toLocaleDateString()}</Date>
  </User>
  ${memoryContext}
  <Page>
    <Title>${pageInfo.title}</Title>
    <PartialAccessibility>
      <!-- This tree represents only the currently visible (viewport) section of the page, not the full page. -->
      ${accessibilityTree ? `<Tree>\n${accessibilityTree}\n</Tree>` : 'Unavailable'}
    </PartialAccessibility>
    ${iframeContent && iframeContent.length > 0 ?
      `<Iframes>
      ${iframeContent.map((iframe, index) =>
        `<Iframe index="${index + 1}" role="${iframe.role}"${iframe.name ? ` name="${iframe.name}"` : ''}>
          <Content>
${iframe.contentSimplified}
          </Content>
        </Iframe>`
      ).join('\n      ')}
    </Iframes>` : ''}
  </Page>
  ${files.length > 0 ?
    `<Files>
    <!-- Files created during this session -->
    ${files.map((file) =>
      `<File>
      <Name>${file.fileName}</Name>
      <Created>${new Date(file.createdAt).toLocaleString()}</Created>
      <Updated>${new Date(file.updatedAt).toLocaleString()}</Updated>
      <Size>${file.size} characters</Size>
    </File>`
    ).join('\n    ')}
  </Files>` : ''}
</Context>

Instructions:
- The user is currently viewing the web page described above.
- The accessibility tree provided is only for the section of the page currently visible to the user (the viewport), not the entire page.
- If you need the full page accessibility tree to answer the user's query, you have the ability to request it at any time.
- Use the page title, URL, and partial accessibility tree to inform your answers.
${iframeContent && iframeContent.length > 0 ? '- The page contains embedded iframes with their own content, which is included above.' : ''}
${files.length > 0 ? `- ${files.length} file${files.length === 1 ? '' : 's'} ${files.length === 1 ? 'has' : 'have'} been created during this session. You can read, update, or reference ${files.length === 1 ? 'this file' : 'these files'} using the file management tools (read_file, update_file, create_file, delete_file, list_files).` : ''}
- If the user asks about the page, refer to this context.
- If the partial accessibility tree is present, use it to answer questions about visible page structure, elements, or accessibility.
- If you need to extract any data from the entire page, you must always use the extract_data tool to do so. Do not attempt to extract data from the full page by any other means.
- If information is missing, answer based on what is available, or request the full page accessibility tree if necessary.
- Always be concise, accurate, and helpful.

Respond to the user's query with this context in mind.
`;
}
