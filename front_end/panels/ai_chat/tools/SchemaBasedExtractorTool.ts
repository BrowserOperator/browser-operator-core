// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Protocol from '../../../generated/protocol.js';
import * as UtilsUniversal from '../common/utils-universal.js';
import { createLogger } from '../core/Logger.js';
import type { LLMContext, Tool } from './Tools.js';
import { callLLMWithTracing } from './LLMTracingWrapper.js';
import { LLMResponseParser } from '../LLM/LLMResponseParser.js';
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

const logger = createLogger('Tool:SchemaBasedExtractor');

// Chunking interfaces
interface ContentChunk {
  id: number;
  content: string;
  tokenCount: number;
  sectionInfo?: {
    heading?: string;
    level?: number;
    startNodeId?: string;
  };
}

interface ChunkExtractionResult {
  chunkId: number;
  data: any;
  itemCount: number;
}

// Define the structure for the metadata LLM call's expected response
interface ExtractionMetadata {
  progress: string;
  completed: boolean;
  reasoning?: string; // Explanation of what data was found and why fields might be missing
  pageContext?: string; // Brief description of what type of page/content was analyzed
  missingFields?: string; // Comma-separated list of fields that couldn't be extracted
}

// Update the result interface to include metadata
export interface SchemaExtractionResult {
  success: boolean;
  data: any | null;
  error?: string;
  metadata?: ExtractionMetadata; // Added metadata field
}

/**
 * Tool for extracting structured data from DOM based on schema definitions
 */
export class SchemaBasedExtractorTool implements Tool<SchemaExtractionArgs, SchemaExtractionResult> {
  // Chunking configuration
  private readonly CHUNK_TOKEN_LIMIT = 40000; // ~160k characters per chunk
  private readonly CHARS_PER_TOKEN = 4; // Conservative estimate
  private readonly TOKEN_LIMIT_FOR_CHUNKING = 65000; // Auto-chunk if tree exceeds this

  name = 'extract_data';
  description = `Extracts structured data from a web page's DOM using a user-provided JSON schema and natural language instruction.
  - The schema defines the exact structure and types of data to extract (e.g., text, numbers, URLs).
  - For fields representing URLs, specify them in the schema as: { type: 'string', format: 'url' }.
  - The tool uses the page's accessibility tree for robust extraction, including hidden or dynamic content.
  - The extraction process is multi-step: it first extracts data (using accessibility node IDs for URLs), then resolves those IDs to actual URLs, and finally provides metadata about extraction progress and completeness.
  - If a detailed or specific extraction is required, clarify it in the instruction.
  - Returns: { success, data, error (if any), metadata }.

Schema Examples:
• Single product: {"type": "object", "properties": {"name": {"type": "string"}, "price": {"type": "number"}, "url": {"type": "string", "format": "url"}}}
• List of items: {"type": "object", "properties": {"items": {"type": "array", "items": {"type": "object", "properties": {"title": {"type": "string"}, "link": {"type": "string", "format": "url"}}}}}}
• Search results: {"type": "object", "properties": {"results": {"type": "array", "items": {"type": "object", "properties": {"title": {"type": "string"}, "snippet": {"type": "string"}, "url": {"type": "string", "format": "url"}}}}}}
• News articles: {"type": "object", "properties": {"articles": {"type": "array", "items": {"type": "object", "properties": {"headline": {"type": "string"}, "author": {"type": "string"}, "publishDate": {"type": "string"}, "link": {"type": "string", "format": "url"}}}}}}`;

  schema = {
    type: 'object',
    properties: {
      schema: {
        type: 'object',
        description: 'JSON Schema definition of the data to extract'
      },
      instruction: {
        type: 'string',
        description: 'Natural language instruction for the extraction agent'
      },
      reasoning: {
        type: 'string',
        description: 'Reasoning about the extraction process displayed to the user'
      }
    },
    required: ['schema', 'instruction', 'reasoning']
  };


  /**
   * Execute the schema-based extraction
   */

  async execute(args: SchemaExtractionArgs, ctx?: LLMContext): Promise<SchemaExtractionResult> {
    logger.debug('Executing with args', args);

    const { schema, instruction, reasoning } = args;

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
        data: null,
        error: 'API key not configured'
      };
    }

    // Enhanced schema validation with helpful error messages
    if (!schema) {
      return {
        success: false,
        data: null,
        error: 'Schema is required. Please provide a JSON Schema definition that describes the structure of data to extract. Example: {"type": "object", "properties": {"title": {"type": "string"}}}'
      };
    }

    try {
      // 1. Get CDP adapter (works in both DevTools and eval runner)
      const adapter = await getAdapter(ctx);
      if (!adapter) {
        return {
          success: false,
          error: 'No browser connection available',
          data: null
        };
      }

      // 2. Transform schema to replace URL fields with numeric AX Node IDs (strings)
      const [transformedSchema, urlPaths] = this.transformUrlFieldsToIds(schema);
      logger.debug('Transformed Schema:', JSON.stringify(transformedSchema, null, 2));
      logger.debug('URL Paths:', urlPaths);

      // 3. Get raw accessibility tree nodes to build URL mapping
      const accessibilityAgent = adapter.accessibilityAgent();
      const rawAxTree = await accessibilityAgent.invoke<{nodes: any[]}>('getFullAXTree', {});
      if (!rawAxTree?.nodes) {
        throw new Error('Failed to get raw accessibility tree nodes');
      }
      // Keep the URL mapping for logging purposes
      const idToUrlMapping = this.buildUrlMapping(rawAxTree.nodes);
      logger.debug(`Built URL mapping with ${Object.keys(idToUrlMapping).length} entries.`);

      // 4. Get the processed accessibility tree text
      const processedTreeResult = await UtilsUniversal.getAccessibilityTree(adapter);
      const treeText = processedTreeResult.simplified;
      logger.debug('Processed Accessibility Tree Text (length):', treeText.length);
      // logger.debug('[SchemaBasedExtractorTool] Tree Text:', treeText); // Uncomment for full tree text

      // Auto-detection: Check if we need to chunk
      const estimatedTokens = this.estimateTokenCount(treeText);
      logger.info(`Tree token count: ${estimatedTokens} (threshold: ${this.TOKEN_LIMIT_FOR_CHUNKING})`);

      let finalData: any;

      if (estimatedTokens > this.TOKEN_LIMIT_FOR_CHUNKING) {
        // ---- Chunked Extraction Flow ----
        logger.info('Tree exceeds token limit, using chunked extraction');

        // Create chunks (tries sections first, falls back to tokens)
        const chunks = this.chunkBySections(treeText);
        logger.info(`Created ${chunks.length} chunks`, chunks.map(c => ({
          id: c.id,
          tokens: c.tokenCount,
          heading: c.sectionInfo?.heading
        })));

        // Extract from each chunk in parallel (4 at a time)
        // Optimized based on Mind2Web validation results (EXTENDED_VALIDATION_RESULTS.md)
        const chunkResults: any[] = new Array(chunks.length);
        const BATCH_SIZE = 4; // Process 4 chunks concurrently

        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
          const batchPromises: Promise<void>[] = [];

          // Create batch of up to 4 promises
          for (let j = 0; j < BATCH_SIZE && i + j < chunks.length; j++) {
            const chunkIndex = i + j;
            const chunk = chunks[chunkIndex];

            logger.info(`Processing chunk ${chunk.id + 1}/${chunks.length} in parallel batch`, {
              batchStart: i + 1,
              batchEnd: Math.min(i + BATCH_SIZE, chunks.length)
            });

            // Create promise and handle errors per chunk
            const promise = this.extractFromChunk(
              chunk,
              transformedSchema,
              instruction || 'Extract data according to schema',
              apiKey || '',
              ctx
            ).then(extractedData => {
              // Store result at correct index to maintain order
              chunkResults[chunkIndex] = extractedData;
              logger.info(`Chunk ${chunk.id + 1} extraction complete`);
            }).catch(error => {
              logger.error(`Error extracting from chunk ${chunk.id}:`, error);
              // Store null on error to maintain order, will be filtered during merge
              chunkResults[chunkIndex] = null;
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

        // Filter out null results from failed chunks
        const validChunkResults = chunkResults.filter(result => result !== null);

        // Merge results using LLM
        logger.info('Merging chunk results with LLM...', {
          totalChunks: chunks.length,
          validChunks: validChunkResults.length,
          failedChunks: chunks.length - validChunkResults.length
        });
        const mergedData = await this.callMergeLLM({
          chunkResults: validChunkResults,
          schema: transformedSchema,
          instruction: instruction || 'Extract data according to schema',
          apiKey: apiKey || '',
          ctx
        });

        if (!mergedData) {
          return {
            success: false,
            error: 'Failed to merge chunk results',
            data: null
          };
        }

        finalData = mergedData;
        logger.info('Chunk merging complete');

      } else {
        // ---- Standard Single-Pass Extraction Flow ----
        logger.info('Using standard single-pass extraction');

        // 5. Initial Extract Call
        logger.debug('Starting initial LLM extraction...');
        const initialExtraction = await this.callExtractionLLM({
          instruction: instruction || 'Extract data according to schema',
          domContent: treeText,
          schema: transformedSchema,
          apiKey: apiKey || '',  // Use empty string for BrowserOperator
          ctx,
        });

        logger.debug('Initial extraction result:', initialExtraction);
        if (!initialExtraction) { // Check if initial extraction failed
          return {
            success: false,
            error: 'Initial data extraction failed',
            data: null,
          };
        }
        // Check if extraction returned a parsing error
        if (initialExtraction.__parsing_failed__) {
          return {
            success: false,
            error: initialExtraction.__error__ || 'JSON parsing failed during extraction',
            data: null,
          };
        }

        // 6. Refine Call
        const refinedData = await this.callRefinementLLM({
          instruction: instruction || 'Refine the extracted data based on the original request',
          schema: transformedSchema, // Use the same transformed schema
          initialData: initialExtraction,
          apiKey: apiKey || '',  // Use empty string for BrowserOperator
          ctx,
        });

        logger.debug('Refinement result:', refinedData);
        if (!refinedData) { // Check if refinement failed
          return {
            success: false,
            error: 'Data refinement step failed',
            data: null,
          };
        }
        // Check if refinement returned a parsing error
        if (refinedData.__parsing_failed__) {
          return {
            success: false,
            error: refinedData.__error__ || 'JSON parsing failed during refinement',
            data: null,
          };
        }

        finalData = refinedData;
      }

      // ---- URL Resolution (common for both flows) ----
      logger.debug('Resolving URLs...');
      const dataWithUrls = await this.resolveUrlsWithLLM({
        data: finalData,
        apiKey: apiKey || '',  // Use empty string for BrowserOperator
        schema, // Original schema to understand what fields are URLs
        idToUrlMapping, // Pre-built accessibility node ID → URL mapping
      });

      logger.debug('Data after URL resolution:',
        JSON.stringify(Array.isArray(dataWithUrls) ? dataWithUrls.slice(0, 2) : dataWithUrls, null, 2).substring(0, 500));

      // Check if any URL fields still contain numeric node IDs
      let urlResolutionWarning: string | undefined;
      const dataString = JSON.stringify(dataWithUrls);
      // Simple heuristic: if we have numbers where URLs are expected in common URL field names
      if (dataString.match(/"(url|link|href|website|webpage)"\s*:\s*\d+/i)) {
        urlResolutionWarning = 'Note: Some URL fields may contain unresolved node IDs instead of actual URLs.';
        logger.warn('Detected potential unresolved node IDs in URL fields');
      }

      // ---- Metadata Call (common for both flows) ----
      const metadata = await this.callMetadataLLM({
        instruction: instruction || 'Assess extraction completion',
        extractedData: dataWithUrls, // Use the final data with URLs for assessment
        domContent: treeText.substring(0, 3000), // Truncate for metadata call
        schema, // Pass the schema to understand what was requested
        apiKey: apiKey || '',  // Use empty string for BrowserOperator
        ctx,
      });

      logger.debug('Metadata result:', metadata);
      if (!metadata) { // Check if metadata call failed
        logger.warn('Metadata extraction step failed, proceeding without metadata.');
      }

      // Prepare the result
      const result: SchemaExtractionResult = {
        success: true,
        data: dataWithUrls,
        metadata: metadata || undefined, // Include metadata if successful, otherwise undefined
      };

      // Add warning message to metadata if URL resolution was incomplete
      if (urlResolutionWarning && result.metadata) {
        result.metadata.progress = result.metadata.progress + ' ' + urlResolutionWarning;
      } else if (urlResolutionWarning) {
        // If no metadata, create minimal metadata with the warning
        result.metadata = {
          progress: urlResolutionWarning,
          completed: true
        };
      }

      return result;
    } catch (error) {
      logger.error('Execution Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        data: null
      };
    }
  }

  /**
   * Transforms schema object, converting URL string fields to numeric IDs
   * @returns Tuple with transformed schema and paths to URL fields
   */
  private transformUrlFieldsToIds(schema: SchemaDefinition): [SchemaDefinition, PathSegment[]] {
    const urlPaths: PathSegment[] = [];
    const transformedSchema = { ...schema };

    // Process root-level properties if they exist
    if (schema.properties) {
      transformedSchema.properties = this.processSchemaProperties(schema.properties || {}, [], urlPaths);
    }

    // Process items if this is an array schema
    if (schema.type === 'array' && schema.items) {
      logger.debug('Processing array items schema');

      // If items is an object with properties, process those
      if (schema.items.type === 'object' && schema.items.properties) {
        const itemProperties = schema.items.properties;
        const processedItemProperties = this.processSchemaProperties(itemProperties, ['*'], urlPaths);
        transformedSchema.items = {
          ...schema.items,
          properties: processedItemProperties
        };
      }
      // If items is a string with url format, transform it
      else if (schema.items.type === 'string' && schema.items.format === 'url') {
        transformedSchema.items = {
          type: 'number',
          description: 'Accessibility Node ID (as a number) of the element that points to a URL'
        };
        urlPaths.push({ segments: ['*'] });
      }
    }

    logger.debug('Transformation complete, found URL paths:', urlPaths);
    return [transformedSchema, urlPaths];
  }

  /**
   * Process schema properties recursively to find and transform URL fields
   */
  private processSchemaProperties(
    properties: Record<string, SchemaProperty>,
    currentPath: Array<string | number>,
    urlPaths: PathSegment[]
  ): Record<string, SchemaProperty> {
    const result: Record<string, SchemaProperty> = {};

    for (const [key, value] of Object.entries(properties)) {
      const newPath = [...currentPath, key];
      let processedValue = { ...value };

      if (value.type === 'string' && value.format === 'url') {
        // Transform to number and update description
        processedValue = {
          type: 'number',
          description: 'Accessibility Node ID (as a number) of the element that points to a URL'
        };
        urlPaths.push({ segments: newPath });
      } else if (value.type === 'object' && value.properties) {
        // Recurse for nested objects
        processedValue.properties = this.processSchemaProperties(value.properties, newPath, urlPaths);
      } else if (value.type === 'array' && value.items) {
        // Handle arrays
        const arrayPath = [...newPath, '*']; // Use '*' to represent array items
        let processedItems = { ...value.items };

        if (value.items.type === 'object' && value.items.properties) {
          // Recurse for objects within arrays
          processedItems.properties = this.processSchemaProperties(value.items.properties, arrayPath, urlPaths);
        } else if (value.items.type === 'string' && value.items.format === 'url') {
          // Transform URL strings within arrays
          processedItems = {
            type: 'number',
            description: 'Accessibility Node ID (as a number) of the element that points to a URL'
          };
          urlPaths.push({ segments: arrayPath });
        }
        processedValue.items = processedItems;
      }
      result[key] = processedValue;
    }
    return result;
  }

  /**
   * Builds a mapping from Accessibility Node ID (string) to URL from raw AX nodes.
   */
  private buildUrlMapping(nodes: Protocol.Accessibility.AXNode[]): Record<string, string> {
    logger.debug(`Building URL mapping from ${nodes.length} nodes`);
    const idToUrlMapping: Record<string, string> = {};
    for (const node of nodes) {
      const urlProperty = node.properties?.find(p =>
        p.name === Protocol.Accessibility.AXPropertyName.Url
      );

      // Use the string node.nodeId as the key
      if (urlProperty?.value?.type === 'string' && urlProperty.value.value && node.nodeId) {
        logger.debug(`Found URL mapping: nodeId=${node.nodeId}, url=${urlProperty.value.value}`);
        idToUrlMapping[node.nodeId] = String(urlProperty.value.value);
      }
    }

    // Log whether we found any mappings
    const mappingSize = Object.keys(idToUrlMapping).length;
    logger.debug(`URL Mapping complete: found ${mappingSize} URL mappings`);
    if (mappingSize === 0) {
      logger.warn('No URL mappings found! URLs will not be injected correctly.');
    } else {
      // Log the first few mappings as a sample
      const sampleEntries = Object.entries(idToUrlMapping).slice(0, 5);
      logger.debug('Sample URL mappings:', sampleEntries);
    }

    return idToUrlMapping;
  }

  /**
   * Initial LLM call to extract data based on schema and DOM content.
   */
  private async callExtractionLLM(options: {
    instruction: string,
    domContent: string,
    schema: SchemaDefinition,
    apiKey: string,
    ctx?: LLMContext,
  }): Promise<any> {
    const { instruction, domContent, schema, apiKey } = options;
    logger.debug('Calling Extraction LLM...');
    const systemPrompt = `You are a structured data extraction agent in multi-agent system.
Your task is to extract data from the provided DOM content (represented as an accessibility tree) based on a given schema.
Focus on mapping the user's instruction to the elements in the accessibility tree.
IMPORTANT: When a URL is expected, you MUST provide the numeric Accessibility Node ID as a NUMBER type, not as a string.
CRITICAL RULES:
1. NEVER hallucinate or make up any data - only extract what actually exists in the accessibility tree
2. For URL fields, provide ONLY the numeric accessibility node ID (e.g., 12345, not "http://example.com")
3. If you cannot find requested data:
   - For required fields: Use null or an empty string/array as appropriate
   - For optional fields: Omit them entirely
   - NEVER make up fake data to fill fields
4. If the requested data doesn't exist, extract what IS available in that section of the DOM
5. Only extract text, numbers, and node IDs that are explicitly present in the accessibility tree
6. The actual URLs will be resolved in a later step using the node IDs
Return ONLY valid JSON that conforms exactly to the provided schema definition. 
Do not add any conversational text or explanations or thinking tags.`;

    const extractionPrompt = `
INSTRUCTION: ${instruction}

ACCESSIBILITY TREE CONTENT:
\`\`\`
${domContent}
\`\`\`

SCHEMA TO EXTRACT (Note: fields expecting URLs require the numeric Accessibility Node ID as a NUMBER type, not a string):
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

TASK: Extract structured data from the ACCESSIBILITY TREE CONTENT according to the INSTRUCTION and the SCHEMA TO EXTRACT.
Return a valid JSON object that conforms exactly to the schema structure. 
CRITICAL: 
- For URL fields, extract ONLY the numeric accessibility node ID from the tree (e.g., 12345)
- DO NOT create or hallucinate any data - only extract what exists in the tree
- If requested data is not found:
  * Return null/empty values for required fields
  * Omit optional fields entirely
  * Extract whatever IS present in that area of the DOM instead
- NEVER make up fake names, titles, descriptions, or any other data
- If you see "No data", "N/A", or similar in the DOM, extract it as-is
- These numeric IDs will be converted to actual URLs in a subsequent processing step
Only output the JSON object with real data from the accessibility tree.`;

    try {
      if (!options.ctx?.provider || !(options.ctx.nanoModel)) {
        throw new Error('Missing LLM context (provider/nano model) for extraction');
      }
      const provider = options.ctx.provider;
      const model = options.ctx.nanoModel;
      const llmResponse = await callLLMWithTracing(
        {
          provider,
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: extractionPrompt }
          ],
          systemPrompt: systemPrompt,
          temperature: 0.1,
          options: { retryConfig: { maxRetries: 3, baseDelayMs: 1500 } }
        },
        {
          toolName: this.name,
          operationName: 'extract_data',
          context: 'schema_extraction',
          additionalMetadata: {
            instructionLength: instruction.length,
            domContentLength: domContent.length,
            schemaFields: Object.keys(schema.properties || {}).length
          }
        }
      );
      const response = llmResponse.text || '';
      try {
        return LLMResponseParser.parseStrictJSON(response);
      } catch {
        try {
          return LLMResponseParser.parseJSONWithFallbacks(response);
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          logger.error('Failed to parse extraction JSON:', e);
          logger.warn('Raw LLM response:', response.substring(0, 500));
          // Return error object with embedded raw response
          return {
            __parsing_failed__: true,
            __error__: `JSON parsing failed during extraction: ${errorMsg}\n\nRaw LLM Response:\n${response}`,
            __raw_response__: response,
            __step__: 'extraction'
          };
        }
      }
    } catch (error) {
      logger.error('Error in callExtractionLLM:', error);
      return null; // Indicate failure
    }
  }

  /**
   * LLM call to refine the initially extracted data.
   */
  private async callRefinementLLM(options: {
    instruction: string,
    schema: SchemaDefinition,
    initialData: any,
    apiKey: string,
    ctx?: LLMContext,
  }): Promise<any> {
    const { instruction, schema, initialData, apiKey } = options;
    logger.debug('Calling Refinement LLM...');
    const systemPrompt = `You are a data refinement agent in multi-agent system.
Your task is to refine previously extracted JSON data based on the original instruction and schema.
Ensure the refined output still strictly conforms to the provided schema.
CRITICAL RULES:
1. When a URL is expected, you MUST provide the numeric Accessibility Node ID as a NUMBER type, not as a string
2. NEVER create or hallucinate any data - work only with what was already extracted
3. DO NOT replace numeric node IDs with made-up URLs like "http://..." 
4. DO NOT add fake data to empty fields - if a field is null/empty, leave it that way
5. Only refine the structure and improve organization - do not invent new content
6. If the initial extraction has null/empty values, that means the data wasn't found - respect that
Focus on improving structure and organization while preserving the truthfulness of the extracted data.
Return ONLY the refined, valid JSON object.`;

    const refinePrompt = `
ORIGINAL INSTRUCTION: ${instruction}

SCHEMA (Note: fields expecting URLs require the numeric Accessibility Node ID as a NUMBER type, not a string):
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

INITIAL EXTRACTED DATA:
\`\`\`json
${JSON.stringify(initialData, null, 2)}
\`\`\`

TASK: Review the INITIAL EXTRACTED DATA. Refine it to better match the ORIGINAL INSTRUCTION and ensure it strictly conforms to the SCHEMA.
IMPORTANT: 
- Keep all numeric node IDs in URL fields exactly as they are (do not change them to URLs)
- These numeric IDs will be converted to actual URLs in a later processing step
- NEVER hallucinate or create URLs - if you see a number in a URL field, leave it as a number
- Focus on refining non-URL data and ensuring proper structure
Return only the refined JSON object. 
Do not add any conversational text or explanations or thinking tags.`;

    try {
      if (!options.ctx?.provider || !(options.ctx.nanoModel || options.ctx.model)) {
        throw new Error('Missing LLM context (provider/model) for refinement');
      }
      const provider = options.ctx.provider;
      const model = options.ctx.nanoModel || options.ctx.model;
      const llmResponse = await callLLMWithTracing(
        {
          provider,
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: refinePrompt }
          ],
          systemPrompt: systemPrompt,
          temperature: 0.1,
          options: { retryConfig: { maxRetries: 3, baseDelayMs: 1500 } }
        },
        {
          toolName: this.name,
          operationName: 'refine_data',
          context: 'data_refinement',
          additionalMetadata: {
            instructionLength: instruction.length,
            initialDataFields: Object.keys(initialData || {}).length
          }
        }
      );
      const response = llmResponse.text || '';
      try {
        return LLMResponseParser.parseStrictJSON(response);
      } catch {
        try {
          return LLMResponseParser.parseJSONWithFallbacks(response);
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          logger.error('Failed to parse refinement JSON:', e);
          logger.warn('Raw LLM response:', response.substring(0, 500));
          // Return error object with embedded raw response
          return {
            __parsing_failed__: true,
            __error__: `JSON parsing failed during refinement: ${errorMsg}\n\nRaw LLM Response:\n${response}`,
            __raw_response__: response,
            __step__: 'refinement'
          };
        }
      }
    } catch (error) {
      logger.error('Error in callRefinementLLM:', error);
      return null; // Indicate failure
    }
  }

  /**
   * LLM call to get metadata (progress and completion status).
   */
  private async callMetadataLLM(options: {
    instruction: string,
    extractedData: any,
    domContent: string,
    schema: SchemaDefinition,
    apiKey: string,
    ctx?: LLMContext,
  }): Promise<ExtractionMetadata | null> {
    const { instruction, extractedData, domContent, schema, apiKey } = options;
    logger.debug('Calling Metadata LLM...');
    const metadataSchema = {
      type: 'object',
      properties: {
        progress: {
          type: 'string',
          description: 'A very concise summary of what has been extracted so far.',
        },
        completed: {
          type: 'boolean',
          description: 'Set to true ONLY if the original instruction has been fully and accurately addressed by the extracted data. Be conservative.',
        },
        reasoning: {
          type: 'string',
          description: 'Brief explanation of extraction results, including why any fields might be missing or contain null values.',
        },
        pageContext: {
          type: 'string',
          description: 'Brief description (10-20 words) of what type of page/content was analyzed (e.g., "GitHub repository page", "News article", "Product listing").',
        },
        missingFields: {
          type: 'string',
          description: 'Comma-separated list of field names that could not be extracted due to missing data on the page. Leave empty if all fields were successfully extracted.',
        },
      },
      required: ['progress', 'completed'],
    };

    const systemPrompt = `You are a metadata assessment agent in multi-agent system.
Your task is to evaluate the provided extracted data against the original instruction and determine the progress and completion status.
You must respond ONLY with a valid JSON object matching the following schema:
\`\`\`json
${JSON.stringify(metadataSchema, null, 2)}
\`\`\`
Do not add any conversational text or explanations or thinking tags.`;

    const metadataPrompt = `
ORIGINAL INSTRUCTION: ${instruction}

REQUESTED SCHEMA:
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

PAGE CONTENT (Accessibility Tree):
\`\`\`
${domContent.substring(0, 3000)}${domContent.length > 3000 ? '... [truncated]' : ''}
\`\`\`

EXTRACTED DATA:
\`\`\`json
${JSON.stringify(extractedData, null, 2)}
\`\`\`

TASK: Analyze the extraction results by comparing:
1. What was requested (INSTRUCTION and SCHEMA)
2. What was available on the page (PAGE CONTENT)
3. What was actually extracted (EXTRACTED DATA)

Identify any fields that are null/empty and explain why (e.g., "price field is null because this is a repository page, not a product page").
Describe the type of page/content that was analyzed.
Return ONLY a valid JSON object conforming to the required metadata schema.`;

    try {
      if (!options.ctx?.provider || !(options.ctx.nanoModel || options.ctx.model)) {
        throw new Error('Missing LLM context (provider/model) for metadata');
      }
      const provider = options.ctx.provider;
      const model = options.ctx.nanoModel || options.ctx.model;
      const llmResponse = await callLLMWithTracing(
        {
          provider,
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: metadataPrompt }
          ],
          systemPrompt: systemPrompt,
          temperature: 0.0, // Use low temp for objective assessment
          options: { retryConfig: { maxRetries: 3, baseDelayMs: 1500 } }
        },
        {
          toolName: this.name,
          operationName: 'assess_metadata',
          context: 'extraction_assessment',
          additionalMetadata: {
            instructionLength: instruction.length,
            hasExtractedData: !!extractedData,
            domContentLength: domContent.length
          }
        }
      );
      const response = llmResponse.text || '';
      let parsedMetadata: any = null;
      try {
        parsedMetadata = LLMResponseParser.parseStrictJSON(response);
      } catch {
        try {
          parsedMetadata = LLMResponseParser.parseJSONWithFallbacks(response);
        } catch (e) {
          logger.error('Failed to parse metadata JSON:', e);
          parsedMetadata = null;
        }
      }
      // Basic validation
      if (typeof parsedMetadata?.progress === 'string' && typeof parsedMetadata?.completed === 'boolean') {
        return parsedMetadata as ExtractionMetadata;
      }
      logger.error('Metadata LLM response did not match expected schema:', parsedMetadata);
      // Return null if metadata doesn't match schema, but don't throw, allow main function to decide
      return null;

    } catch (error) {
      logger.error('Error in callMetadataLLM:', error);
      return null; // Indicate failure
    }
  }


  /**
   * Recursively find and replace node IDs with URLs in a data structure
   * Handles both numeric IDs (from LLM) and string IDs (from accessibility tree)
   */
  private findAndReplaceNodeIds(data: any, nodeIdToUrlMap: Record<string, string>): any {
    // Handle null/undefined
    if (data === null || data === undefined) {
      return data;
    }

    // Check if it's a node ID (number or string) that matches a key in the URL map
    // LLM returns numbers like 19951, accessibility tree uses strings like "19951"
    if (typeof data === 'number' || typeof data === 'string') {
      const nodeIdKey = String(data);
      if (nodeIdToUrlMap[nodeIdKey]) {
        return nodeIdToUrlMap[nodeIdKey];
      }
    }

    // Recursively process arrays
    if (Array.isArray(data)) {
      return data.map(item => this.findAndReplaceNodeIds(item, nodeIdToUrlMap));
    }

    // Recursively process objects
    if (typeof data === 'object' && data !== null) {
      const result: any = {};
      for (const [key, value] of Object.entries(data)) {
        result[key] = this.findAndReplaceNodeIds(value, nodeIdToUrlMap);
      }
      return result;
    }

    // Return data unchanged for other types
    return data;
  }

  /**
   * Resolve URLs in the data using the pre-built URL mapping
   * Uses the accessibility node ID → URL mapping built from the raw AX tree
   */
  private async resolveUrlsWithLLM(options: {
    data: any,
    apiKey: string,
    schema: SchemaDefinition,
    idToUrlMapping: Record<string, string>,
  }): Promise<any> {
    const { data, idToUrlMapping } = options;
    logger.debug('Starting URL resolution using pre-built mapping...');

    try {
      if (Object.keys(idToUrlMapping).length === 0) {
        logger.debug('No URL mappings available, returning original data');
        return data;
      }

      logger.debug(`Using pre-built URL mapping with ${Object.keys(idToUrlMapping).length} entries`);

      // Replace node IDs with URLs in the data
      // findAndReplaceNodeIds handles both numeric (from LLM) and string (accessibility) IDs
      const updatedData = this.findAndReplaceNodeIds(data, idToUrlMapping);

      logger.debug('Successfully replaced nodeIDs with URLs');
      return updatedData;
    } catch (error) {
      logger.error('[SchemaBasedExtractorTool] Error in URL resolution:', error);
      return data; // Return original data on error
    }
  }

  /**
   * Estimates token count from text
   */
  private estimateTokenCount(text: string): number {
    return Math.ceil(text.length / this.CHARS_PER_TOKEN);
  }

  /**
   * Chunks content by detecting sections (headings in accessibility tree)
   */
  private chunkBySections(treeText: string): ContentChunk[] {
    const chunks: ContentChunk[] = [];

    // Split by heading patterns in accessibility tree
    // Format: [nodeId] heading: Heading Text
    const lines = treeText.split('\n');
    const sectionStarts: Array<{ index: number, heading: string, nodeId: string, level: number }> = [];

    // Find all headings
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Match patterns like: [123] heading: Some Heading Text
      const headingMatch = line.match(/\[(\d+)\]\s+heading(?:\s+level (\d+))?:\s*(.+)/i);
      if (headingMatch) {
        const nodeId = headingMatch[1];
        const level = headingMatch[2] ? parseInt(headingMatch[2]) : 2; // Default to level 2
        const heading = headingMatch[3].trim();
        sectionStarts.push({ index: i, heading, nodeId, level });
      }
    }

    logger.debug(`Found ${sectionStarts.length} section headings`);

    // If no headings found, fall back to token-based chunking
    if (sectionStarts.length === 0) {
      logger.warn('No section headings found, falling back to token-based chunking');
      return this.chunkByTokens(treeText);
    }

    // Create chunks from sections
    let chunkId = 0;
    let currentChunkLines: string[] = [];
    let currentChunkStart = 0;

    for (let i = 0; i < sectionStarts.length; i++) {
      const section = sectionStarts[i];
      const nextSection = sectionStarts[i + 1];

      // Extract lines for this section
      const sectionEnd = nextSection ? nextSection.index : lines.length;
      const sectionLines = lines.slice(section.index, sectionEnd);

      // Check if adding this section would exceed limit
      const combinedLines = [...currentChunkLines, ...sectionLines];
      const combinedText = combinedLines.join('\n');
      const combinedTokens = this.estimateTokenCount(combinedText);

      if (combinedTokens > this.CHUNK_TOKEN_LIMIT && currentChunkLines.length > 0) {
        // Create chunk from accumulated content
        const chunkText = currentChunkLines.join('\n');
        chunks.push({
          id: chunkId++,
          content: chunkText,
          tokenCount: this.estimateTokenCount(chunkText),
          sectionInfo: {
            heading: sectionStarts[currentChunkStart]?.heading,
            level: sectionStarts[currentChunkStart]?.level,
            startNodeId: sectionStarts[currentChunkStart]?.nodeId
          }
        });

        // Start new chunk with current section
        currentChunkLines = sectionLines;
        currentChunkStart = i;
      } else {
        // Add section to current chunk
        currentChunkLines.push(...sectionLines);
      }
    }

    // Add final chunk if there's content
    if (currentChunkLines.length > 0) {
      const chunkText = currentChunkLines.join('\n');
      chunks.push({
        id: chunkId++,
        content: chunkText,
        tokenCount: this.estimateTokenCount(chunkText),
        sectionInfo: {
          heading: sectionStarts[currentChunkStart]?.heading,
          level: sectionStarts[currentChunkStart]?.level,
          startNodeId: sectionStarts[currentChunkStart]?.nodeId
        }
      });
    }

    return chunks;
  }

  /**
   * Chunks content by token count (fallback when no sections detected)
   */
  private chunkByTokens(treeText: string): ContentChunk[] {
    const chunks: ContentChunk[] = [];
    const lines = treeText.split('\n');

    let chunkId = 0;
    let currentChunkLines: string[] = [];
    let currentTokens = 0;

    for (const line of lines) {
      const lineTokens = this.estimateTokenCount(line);

      if (currentTokens + lineTokens > this.CHUNK_TOKEN_LIMIT && currentChunkLines.length > 0) {
        // Create chunk
        const chunkText = currentChunkLines.join('\n');
        chunks.push({
          id: chunkId++,
          content: chunkText,
          tokenCount: currentTokens
        });

        // Start new chunk
        currentChunkLines = [line];
        currentTokens = lineTokens;
      } else {
        currentChunkLines.push(line);
        currentTokens += lineTokens;
      }
    }

    // Add final chunk
    if (currentChunkLines.length > 0) {
      chunks.push({
        id: chunkId++,
        content: currentChunkLines.join('\n'),
        tokenCount: currentTokens
      });
    }

    return chunks;
  }

  /**
   * Extract data from a single chunk using LLM
   */
  private async extractFromChunk(
    chunk: ContentChunk,
    schema: SchemaDefinition,
    instruction: string,
    apiKey: string,
    ctx?: LLMContext
  ): Promise<any> {
    const systemPrompt = `You are a structured data extraction agent.
Your task is to extract data from a CHUNK of a larger document based on a given schema.
This chunk is part ${chunk.id + 1} of a larger page.
${chunk.sectionInfo?.heading ? `This chunk covers the section: "${chunk.sectionInfo.heading}"` : ''}

CRITICAL RULES:
1. ONLY extract data that exists in THIS chunk - do not hallucinate
2. If no relevant data exists in this chunk, return an empty result
3. For URL fields, extract the numeric accessibility node ID (not the URL string)
4. Return ONLY valid JSON matching the schema

Focus on extracting any relevant data from this chunk. The results will be merged with other chunks.`;

    const extractionPrompt = `
INSTRUCTION: ${instruction}

SCHEMA:
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

CHUNK CONTENT (Part ${chunk.id + 1}):
\`\`\`
${chunk.content}
\`\`\`

Extract structured data from this chunk according to the schema.
Return ONLY the JSON object.`;

    try {
      if (!ctx?.provider || !ctx.nanoModel) {
        throw new Error('Missing LLM context for extraction');
      }

      const llmResponse = await callLLMWithTracing(
        {
          provider: ctx.provider,
          model: ctx.nanoModel || ctx.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: extractionPrompt }
          ],
          systemPrompt,
          temperature: 0.1,
          options: { retryConfig: { maxRetries: 2, baseDelayMs: 1000 } }
        },
        {
          toolName: this.name,
          operationName: 'extract_chunk',
          context: `chunk_${chunk.id}`,
          additionalMetadata: {
            chunkId: chunk.id,
            chunkTokens: chunk.tokenCount,
            section: chunk.sectionInfo?.heading
          }
        }
      );

      const response = llmResponse.text || '';
      return LLMResponseParser.parseJSONWithFallbacks(response);
    } catch (error) {
      logger.error(`Error extracting from chunk ${chunk.id}:`, error);
      throw error;
    }
  }

  /**
   * LLM call to merge chunk results into final data
   */
  private async callMergeLLM(options: {
    chunkResults: any[],
    schema: SchemaDefinition,
    instruction: string,
    apiKey: string,
    ctx?: LLMContext,
  }): Promise<any> {
    const { chunkResults, schema, instruction, apiKey } = options;
    logger.debug('Calling Merge LLM to combine chunk results...');

    const systemPrompt = `You are a data merging agent in a multi-agent system.
Your task is to intelligently merge multiple JSON extraction results from different chunks of the same page.

CRITICAL RULES:
1. Merge all data into a single result conforming to the schema
2. Remove duplicates (same items appearing in multiple chunks)
3. Maintain numeric node IDs for URL fields - DO NOT convert to URLs
4. If the schema expects an array, combine all arrays and deduplicate
5. If the schema expects an object with arrays, merge each array property separately
6. Return ONLY valid JSON matching the schema

Focus on creating a complete, deduplicated result from all chunks.`;

    const mergePrompt = `
ORIGINAL INSTRUCTION: ${instruction}

SCHEMA:
\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

CHUNK RESULTS (${chunkResults.length} chunks):
\`\`\`json
${JSON.stringify(chunkResults, null, 2)}
\`\`\`

TASK: Merge all chunk results into a single result that conforms to the schema.
- Remove duplicate items (compare by content, not just IDs)
- Combine all arrays
- Keep numeric node IDs in URL fields
Return ONLY the merged JSON object.`;

    try {
      if (!options.ctx?.provider || !(options.ctx.nanoModel || options.ctx.model)) {
        throw new Error('Missing LLM context for merging');
      }
      const provider = options.ctx.provider;
      const model = options.ctx.nanoModel || options.ctx.model;
      const llmResponse = await callLLMWithTracing(
        {
          provider,
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: mergePrompt }
          ],
          systemPrompt,
          temperature: 0.1,
          options: { retryConfig: { maxRetries: 3, baseDelayMs: 1500 } }
        },
        {
          toolName: this.name,
          operationName: 'merge_chunks',
          context: 'chunk_merging',
          additionalMetadata: {
            chunkCount: chunkResults.length,
            instructionLength: instruction.length
          }
        }
      );
      const response = llmResponse.text || '';
      try {
        return LLMResponseParser.parseStrictJSON(response);
      } catch {
        try {
          return LLMResponseParser.parseJSONWithFallbacks(response);
        } catch (e) {
          logger.error('Failed to parse merge JSON:', e);
          logger.warn('Raw LLM response:', response.substring(0, 500));
          return null;
        }
      }
    } catch (error) {
      logger.error('Error in callMergeLLM:', error);
      return null;
    }
  }
}

/**
 * Arguments for schema extraction
 */
export interface SchemaExtractionArgs {
  schema: SchemaDefinition;
  instruction?: string;
  reasoning?: string;
}

/**
 * Schema definition structure (JSON Schema-like)
 */
export interface SchemaDefinition {
  type: string;
  properties?: Record<string, SchemaProperty>;
  items?: SchemaProperty;
  required?: string[];
  [key: string]: any;
}

/**
 * Schema property definition
 */
export interface SchemaProperty {
  type: string;
  description?: string;
  format?: string;
  properties?: Record<string, SchemaProperty>;
  items?: SchemaProperty;
  [key: string]: any;
}

/**
 * Path segments for URL injection
 */
export interface PathSegment {
  segments: Array<string | number>;
}
