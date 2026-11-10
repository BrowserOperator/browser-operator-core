// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Protocol from '../../../generated/protocol.js';
import * as UtilsUniversal from '../common/utils-universal.js';
import { createLogger } from '../core/Logger.js';
import { callLLMWithTracing } from './LLMTracingWrapper.js';
import { type Tool, type LLMContext } from './Tools.js';
import type { LLMProvider } from '../LLM/LLMTypes.js';
import { ContentChunker } from '../utils/ContentChunker.js';
import { getAdapter } from '../cdp/getAdapter.js';
import type { CDPSessionAdapter } from '../cdp/CDPSessionAdapter.js';

// Detect if we're in a Node.js environment (eval runner, tests)
const isNodeEnvironment = typeof window === 'undefined' || typeof document === 'undefined';

// Lazy-loaded browser-only dependencies for API key fallback
let AgentService: typeof import('../core/AgentService.js').AgentService | null = null;
let agentServiceLoaded = false;

async function ensureAgentService(): Promise<boolean> {
  if (isNodeEnvironment) return false;
  if (!agentServiceLoaded) {
    agentServiceLoaded = true;
    try {
      const agentServiceModule = await import('../core/AgentService.js');
      AgentService = agentServiceModule.AgentService;
    } catch { return false; }
  }
  return AgentService !== null;
}

const logger = createLogger('Tool:HTMLToMarkdown');

/**
 * Result interface for HTML to Markdown extraction
 */
export interface HTMLToMarkdownResult {
  success: boolean;
  markdownContent: string | null;
  error?: string;
}

/**
 * Arguments for HTML to Markdown extraction
 */
export interface HTMLToMarkdownArgs {
  instruction?: string;
  reasoning: string;
}

/**
 * Tool for extracting the main article content from a webpage and converting it to Markdown
 */
export class HTMLToMarkdownTool implements Tool<HTMLToMarkdownArgs, HTMLToMarkdownResult> {
  // Chunking configuration
  private readonly TOKEN_LIMIT_FOR_CHUNKING = 65000; // Auto-chunk if tree exceeds this (~260k chars)
  private readonly CHUNK_TOKEN_LIMIT = 40000; // Max tokens per chunk (~160k chars)
  private readonly CHARS_PER_TOKEN = 4; // Conservative estimate

  private contentChunker = new ContentChunker();

  name = 'html_to_markdown';
  description = 'Extracts the main article content from a webpage and converts it to well-formatted Markdown, removing ads, navigation, and other distracting elements. Automatically chunks large pages for efficient processing.';


  schema = {
    type: 'object',
    properties: {
      instruction: {
        type: 'string',
        description: 'Natural language instruction for the extraction agent'
      },
      reasoning: {
        type: 'string',
        description: 'Reasoning about the extraction process displayed to the user'
      }
    },
    required: ['reasoning']
  };


  /**
   * Execute the HTML to Markdown extraction
   */
  async execute(args: HTMLToMarkdownArgs, ctx?: LLMContext): Promise<HTMLToMarkdownResult> {
    logger.info('Executing with args', { args });
    const { instruction } = args;
    const READINESS_TIMEOUT_MS = 15000; // 15 seconds timeout for page readiness

    // Get API key from context first, fallback to AgentService in browser
    let apiKey = ctx?.apiKey;
    if (!apiKey && !isNodeEnvironment) {
      await ensureAgentService();
      if (AgentService) {
        apiKey = AgentService.getInstance().getApiKey() ?? undefined;
      }
    }

    // Get provider from context
    const provider = ctx?.provider;

    // LiteLLM and BrowserOperator have optional API keys
    const requiresApiKey = provider !== 'litellm' && provider !== 'browseroperator';

    if (requiresApiKey && !apiKey) {
      return {
        success: false,
        markdownContent: null,
        error: 'API key not configured'
      };
    }

    try {
      // Get CDP adapter (works in both DevTools and eval runner)
      const adapter = await getAdapter(ctx);
      if (!adapter) {
        return {
          success: false,
          markdownContent: null,
          error: 'No browser connection available'
        };
      }

      // Get the page content from the accessibility tree
      logger.info('Getting page content from accessibility tree');
      const content = await this.getPageContent(adapter);

      if (!content) {
        return {
          success: false,
          markdownContent: null,
          error: 'Failed to retrieve page content'
        };
      }

      logger.info('Retrieved page content', { contentLength: content.length });

      // Check if we need to chunk the content
      const estimatedTokens = Math.ceil(content.length / this.CHARS_PER_TOKEN);
      logger.info('Estimated token count', { estimatedTokens });

      if (!ctx?.provider || !ctx.nanoModel) {
        return {
          success: false,
          markdownContent: null,
          error: 'Missing LLM context (provider/nanoModel) for HTMLToMarkdownTool'
        };
      }

      let markdownContent: string;

      // If content is too large, use chunking
      if (estimatedTokens > this.TOKEN_LIMIT_FOR_CHUNKING) {
        logger.info('Content exceeds token limit, using chunked processing', {
          estimatedTokens,
          limit: this.TOKEN_LIMIT_FOR_CHUNKING
        });

        markdownContent = await this.processWithChunking(content, instruction, apiKey || '', ctx.provider, ctx.nanoModel);
      } else {
        // Normal processing for smaller content
        logger.info('Using standard processing');
        const systemPrompt = this.createSystemPrompt();
        const userPrompt = this.createUserPrompt(content, instruction);

        const extractionResult = await this.callExtractionLLM({
          systemPrompt,
          userPrompt,
          apiKey: apiKey || '',
          provider: ctx.provider,
          model: ctx.nanoModel,
        });

        markdownContent = extractionResult.markdownContent;
      }

      logger.info('Extraction completed successfully');

      // Return the result
      return {
        success: true,
        markdownContent
      };

    } catch (error: any) {
      logger.error('Error during extraction', { error: error.message, stack: error.stack });
      return {
        success: false,
        markdownContent: null,
        error: `Error extracting markdown: ${error.message}`
      };
    }
  }

  /**
   * Get page content from the accessibility tree
   */
  private async getPageContent(adapter: CDPSessionAdapter): Promise<string> {
    // Get accessibility tree using universal utility
    const processedTreeResult = await UtilsUniversal.getAccessibilityTree(adapter);
    return processedTreeResult.simplified;
  }

  /**
   * Create system prompt for the LLM
   */
  private createSystemPrompt(): string {
    return `# Accessibility Tree to Markdown Conversion Agent

## Objective
You are an Accessibility Tree to Markdown conversion agent designed to transform web pages into clean, distraction-free Markdown content. Your purpose is to enhance the reading experience by extracting the main article content while removing distracting elements such as advertisements, navigation menus, popups, sidebars, and unnecessary formatting.

## Input
- Accessibility Tree representation of a web page
- Optional user preferences for conversion

## Output
- Clean, well-formatted Markdown content
- A brief summary of what was extracted and what was removed (optional)

## Core Responsibilities

### 1. Accessibility Tree Analysis
- Leverage the hierarchical structure of the Accessibility Tree to identify the main content
- Use accessibility roles and properties to distinguish content types
- Recognize content boundaries through parent-child relationships in the tree
- Identify landmarks and ARIA roles that signify different page sections

### 2. Content Extraction
- Extract the primary textual content, focusing on:
  - Elements with roles like "heading", "article", "main", "document"
  - Text nodes that are descendants of content containers
  - Images with proper alternative text
  - Tables marked with appropriate semantic roles
  - Lists and their items
  - Quotes and emphasized content

### 3. Content Filtering
- Remove distracting elements by filtering out:
  - Nodes with roles like "banner", "navigation", "complementary", "advertisement"
  - Elements marked as "presentation" that don't contribute to content
  - Hidden elements (those with aria-hidden="true")
  - Repetitive UI controls and widgets
  - Content identified as not being part of the main article flow

### 4. Markdown Conversion
- Convert accessibility nodes to appropriate Markdown syntax:
  - Heading roles → Markdown headings (#, ##, etc. based on level)
  - Text nodes → Plain text with appropriate paragraph breaks
  - Strong/emphasized text → **bold**, *italic*
  - Link roles → [text](url)
  - Image roles → ![alt text](image url)
  - List roles → Markdown bullet/numbered lists
  - Blockquote roles → > quoted text
  - Code/preformatted text → \`\`\` code \`\`\`
  - Table roles → Markdown tables
  - Separator roles → ---

### 5. Structure Preservation
- Maintain the logical hierarchy of the Accessibility Tree
- Preserve the reading order based on the tree traversal
- Respect parent-child relationships when determining content flow
- Maintain the content's semantic structure

### 6. Image Handling
- Include images that have proper alternative text
- Convert image captions based on related accessibility properties
- Filter out decorative images (those marked with alt="" or role="presentation")
- Preserve the relationship between images and their descriptive text

### 7. Metadata Extraction
- Identify document title from the Accessibility Tree
- Extract author information from appropriate labeled elements
- Preserve publication date when available in a structured format

## Advanced Features

### Semantic Understanding
- Use semantic roles to better understand content purpose
- Leverage ARIA properties and states for additional context
- Identify custom roles and their intended meaning

### Content Relationships
- Preserve relationships between elements (such as labels and their controls)
- Maintain the connection between headers and their content sections
- Understand figure/figcaption relationships

### Adaptive Processing
- Adjust extraction strategy based on the complexity of the Accessibility Tree
- Handle different page types (article, documentation, product page, etc.)
- Apply specialized processing for specific content domains

## Implementation Guidelines

1. **Prioritize Semantic Structure**: The Accessibility Tree already provides semantic meaning—use this to your advantage.

2. **Follow Focus Order**: The natural traversal of the Accessibility Tree often indicates the intended reading order.

3. **Respect ARIA Landmarks**: Use landmarks like "main", "article", and "contentinfo" to guide your extraction.

4. **Contextual Analysis**: Look at parent-child relationships to understand content context and importance.

5. **Text Alternatives**: Use provided text alternatives for non-text content as defined in the Accessibility Tree.

## Example Conversions

### News Article
- Identify the article node in the Accessibility Tree
- Extract headings, paragraphs, and related images
- Filter out navigation, sidebar, and footer nodes

### Technical Documentation
- Preserve code blocks identified by appropriate roles
- Maintain table structures with their accessibility properties
- Keep the hierarchical structure of sections and subsections

### Blog Post
- Identify the main content area using landmark roles
- Extract article title, author information, and publication date
- Preserve the flow of text, images, and embedded media

## Performance Considerations
- Leverage the already-processed nature of the Accessibility Tree for faster extraction
- Use efficient tree traversal techniques
- Prioritize nodes with high information density

## Edge Cases

### Dynamic Content
- Handle nodes that represent expandable content
- Account for content loaded on-demand in the Accessibility Tree
- Address tabbed interfaces and their content

### Complex Controls
- Extract meaningful content from complex UI controls
- Handle custom widgets with specialized ARIA roles
- Convert interactive elements to appropriate static content

### Non-Standard Implementations
- Handle pages with improper accessibility implementations
- Apply fallback strategies when semantic information is missing
- Infer structure when standard roles are not used correctly

## Success Criteria
Your conversion is successful when:
- The main article content is preserved in its entirety
- The logical structure and reading flow are maintained
- Distracting elements are removed
- The resulting Markdown is clean, well-formatted, and readable
- The essence and meaning of the original content remain intact
- Accessibility information is leveraged to enhance the quality of extraction
    `;
  }

  /**
   * Create user prompt for the LLM
   */
  private createUserPrompt(content: string, instruction?: string): string {
    return `Here is the accessibility tree:

${content}

Here is the instruction from planning agent:

${instruction}
`;
  }

  /**
   * Process large content by chunking the raw accessibility tree
   * and extracting markdown from each chunk separately
   */
  private async processWithChunking(
    content: string,
    instruction: string | undefined,
    apiKey: string,
    provider: LLMProvider,
    model: string
  ): Promise<string> {
    // Chunk the raw accessibility tree content
    logger.info('Chunking raw accessibility tree content');
    const chunks = this.contentChunker.chunk(content, {
      maxTokensPerChunk: this.CHUNK_TOKEN_LIMIT,
      strategy: 'accessibility-tree', // Split on [nodeId] boundaries
      preserveContext: false
    });

    logger.info('Created chunks from accessibility tree', { chunkCount: chunks.length });

    // Extract markdown from each accessibility tree chunk in parallel (4 at a time)
    const markdownChunks: string[] = new Array(chunks.length);
    const BATCH_SIZE = 4; // Process 4 chunks concurrently

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batchPromises: Promise<string>[] = [];

      // Create batch of up to 4 promises
      for (let j = 0; j < BATCH_SIZE && i + j < chunks.length; j++) {
        const chunkIndex = i + j;
        const chunk = chunks[chunkIndex];

        logger.info(`Processing chunk ${chunkIndex + 1}/${chunks.length} in parallel batch`, {
          batchStart: i + 1,
          batchEnd: Math.min(i + BATCH_SIZE, chunks.length),
          tokenEstimate: chunk.tokenEstimate
        });

        const systemPrompt = this.createSystemPrompt();
        const userPrompt = this.createUserPrompt(chunk.content, instruction);

        // Create promise and handle errors per chunk
        const promise = this.callExtractionLLM({
          systemPrompt,
          userPrompt,
          apiKey,
          provider,
          model,
        }).then(result => {
          // Store result at correct index to maintain order
          markdownChunks[chunkIndex] = result.markdownContent;
          return result.markdownContent;
        }).catch(error => {
          logger.error(`Error processing chunk ${chunkIndex + 1}`, { error });
          // Store empty string on error to maintain order
          markdownChunks[chunkIndex] = '';
          return '';
        });

        batchPromises.push(promise);
      }

      // Wait for current batch to complete before starting next batch
      logger.info(`Waiting for batch to complete`, {
        batchStart: i + 1,
        batchSize: batchPromises.length
      });
      await Promise.all(batchPromises);
      logger.info(`Batch completed`, {
        batchStart: i + 1,
        completedChunks: i + batchPromises.length
      });
    }

    // Combine markdown results
    const mergedMarkdown = markdownChunks.join('\n\n');
    logger.info('Combined markdown from all chunks', {
      totalChunks: chunks.length,
      finalLength: mergedMarkdown.length
    });

    return mergedMarkdown;
  }

  /**
   * Call LLM for extraction
   */
  private async callExtractionLLM(params: {
    systemPrompt: string,
    userPrompt: string,
    apiKey: string,
    provider: LLMProvider,
    model: string,
  }): Promise<{
    markdownContent: string,
  }> {
    // Call LLM using the unified client with tracing
    const provider = params.provider;
    const model = params.model;
    const llmResponse = await callLLMWithTracing(
      {
        provider,
        model,
        messages: [
          { role: 'system', content: params.systemPrompt },
          { role: 'user', content: params.userPrompt }
        ],
        systemPrompt: params.systemPrompt,
        temperature: 0.2 // Lower temperature for more deterministic results
      },
      {
        toolName: this.name,
        operationName: 'html_to_markdown',
        context: 'content_extraction',
        additionalMetadata: {
          promptLength: params.userPrompt.length
        }
      }
    );
    const response = llmResponse.text;

    // Process the response - UnifiedLLMClient returns string directly
    const markdownContent = response || '';

    return {
      markdownContent
    };
  }
}
