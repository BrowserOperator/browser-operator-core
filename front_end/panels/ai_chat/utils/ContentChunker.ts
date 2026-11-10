// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { createLogger } from '../core/Logger.js';

const logger = createLogger('Utils:ContentChunker');

/**
 * Represents a chunk of content with metadata
 */
export interface ContentChunk {
  id: string;
  content: string;
  heading: string;
  startPosition: number;
  endPosition: number;
  tokenEstimate: number;
  level?: number; // Heading level (1 for H1, 2 for H2, etc.)
  // Future extensions for LLM×MapReduce:
  // confidence?: number;
  // keyFacts?: string[];
  // reasoning?: string;
}

/**
 * Options for content chunking
 */
export interface ChunkingOptions {
  maxTokensPerChunk?: number; // Default: 40000
  strategy?: 'headings' | 'paragraphs' | 'hybrid' | 'accessibility-tree'; // Default: 'hybrid'
  preserveContext?: boolean; // Include parent headings in chunk content
  charsPerToken?: number; // Default: 4 (conservative estimate)
}

/**
 * Utility class for semantically chunking markdown content
 *
 * This chunker splits content at semantic boundaries (headings, paragraphs)
 * while respecting token limits. Designed to be extensible for future
 * LLM×MapReduce implementations.
 */
export class ContentChunker {
  private readonly DEFAULT_MAX_TOKENS = 40000;
  private readonly DEFAULT_CHARS_PER_TOKEN = 4;
  private readonly DEFAULT_STRATEGY = 'hybrid';

  /**
   * Chunk markdown content into semantic pieces
   */
  chunk(content: string, options: ChunkingOptions = {}): ContentChunk[] {
    const maxTokens = options.maxTokensPerChunk ?? this.DEFAULT_MAX_TOKENS;
    const strategy = options.strategy ?? this.DEFAULT_STRATEGY;
    const preserveContext = options.preserveContext ?? true;
    const charsPerToken = options.charsPerToken ?? this.DEFAULT_CHARS_PER_TOKEN;

    logger.info('Chunking content', {
      contentLength: content.length,
      estimatedTokens: Math.ceil(content.length / charsPerToken),
      maxTokens,
      strategy
    });

    // If content is small enough, return as single chunk
    const totalTokens = this.estimateTokens(content, charsPerToken);
    if (totalTokens <= maxTokens) {
      logger.info('Content fits in single chunk, no splitting needed');
      return [{
        id: 'chunk-0',
        content,
        heading: '',
        startPosition: 0,
        endPosition: content.length,
        tokenEstimate: totalTokens,
      }];
    }

    // Choose chunking strategy
    switch (strategy) {
      case 'headings':
        return this.chunkByHeadings(content, maxTokens, charsPerToken, preserveContext);
      case 'paragraphs':
        return this.chunkByParagraphs(content, maxTokens, charsPerToken);
      case 'accessibility-tree':
        return this.chunkByAccessibilityNodes(content, maxTokens, charsPerToken);
      case 'hybrid':
      default:
        return this.chunkHybrid(content, maxTokens, charsPerToken, preserveContext);
    }
  }

  /**
   * Chunk content by heading boundaries (H1, H2, H3)
   */
  private chunkByHeadings(
    content: string,
    maxTokens: number,
    charsPerToken: number,
    preserveContext: boolean
  ): ContentChunk[] {
    const sections = this.parseHeadings(content);
    const chunks: ContentChunk[] = [];
    let currentChunk = '';
    let currentHeading = '';
    let currentLevel = 0;
    let currentStart = 0;
    let chunkId = 0;

    for (const section of sections) {
      const sectionTokens = this.estimateTokens(section.content, charsPerToken);
      const currentChunkTokens = this.estimateTokens(currentChunk, charsPerToken);

      // If section itself is too large, split it further
      if (sectionTokens > maxTokens) {
        // Flush current chunk if it has content
        if (currentChunk) {
          chunks.push({
            id: `chunk-${chunkId++}`,
            content: currentChunk,
            heading: currentHeading,
            startPosition: currentStart,
            endPosition: currentStart + currentChunk.length,
            tokenEstimate: currentChunkTokens,
            level: currentLevel,
          });
          currentChunk = '';
        }

        // Split large section by paragraphs
        const subChunks = this.chunkByParagraphs(section.content, maxTokens, charsPerToken);
        subChunks.forEach((subChunk) => {
          chunks.push({
            ...subChunk,
            id: `chunk-${chunkId++}`,
            heading: section.heading,
            level: section.level,
          });
        });
        currentStart = section.end;
        continue;
      }

      // If adding this section would exceed limit, flush current chunk
      if (currentChunk && currentChunkTokens + sectionTokens > maxTokens) {
        chunks.push({
          id: `chunk-${chunkId++}`,
          content: currentChunk,
          heading: currentHeading,
          startPosition: currentStart,
          endPosition: currentStart + currentChunk.length,
          tokenEstimate: currentChunkTokens,
          level: currentLevel,
        });
        currentChunk = '';
        currentStart = section.start;
      }

      // Add section to current chunk
      if (!currentChunk) {
        currentHeading = section.heading;
        currentLevel = section.level;
        currentStart = section.start;
      }
      currentChunk += section.content;
    }

    // Flush final chunk
    if (currentChunk) {
      chunks.push({
        id: `chunk-${chunkId++}`,
        content: currentChunk,
        heading: currentHeading,
        startPosition: currentStart,
        endPosition: currentStart + currentChunk.length,
        tokenEstimate: this.estimateTokens(currentChunk, charsPerToken),
        level: currentLevel,
      });
    }

    logger.info('Chunked by headings', { chunkCount: chunks.length });
    return chunks;
  }

  /**
   * Chunk content by accessibility tree node boundaries
   * Splits before lines starting with [nodeId] pattern
   */
  private chunkByAccessibilityNodes(
    content: string,
    maxTokens: number,
    charsPerToken: number
  ): ContentChunk[] {
    const lines = content.split('\n');
    const chunks: ContentChunk[] = [];
    let currentChunk: string[] = [];
    let currentTokens = 0;
    let chunkId = 0;
    let startPosition = 0;
    let position = 0;

    for (const line of lines) {
      // Check if line starts with [nodeId] pattern (including indented nodes)
      // EncodedId format is [frameOrdinal-backendNodeId] e.g., [0-123]
      const isNodeStart = /^\s*\[\d+-\d+\]/.test(line);
      const lineTokens = this.estimateTokens(line + '\n', charsPerToken);

      // If adding this line exceeds limit AND we're at a node boundary, flush chunk
      if (isNodeStart && currentTokens + lineTokens > maxTokens && currentChunk.length > 0) {
        const chunkContent = currentChunk.join('\n');
        chunks.push({
          id: `chunk-${chunkId++}`,
          content: chunkContent,
          heading: '',
          startPosition,
          endPosition: position,
          tokenEstimate: currentTokens,
        });

        currentChunk = [];
        currentTokens = 0;
        startPosition = position;
      }

      currentChunk.push(line);
      currentTokens += lineTokens;
      position += line.length + 1; // +1 for newline
    }

    // Flush final chunk
    if (currentChunk.length > 0) {
      const chunkContent = currentChunk.join('\n');
      chunks.push({
        id: `chunk-${chunkId++}`,
        content: chunkContent,
        heading: '',
        startPosition,
        endPosition: content.length,
        tokenEstimate: currentTokens,
      });
    }

    logger.info('Chunked by accessibility nodes', { chunkCount: chunks.length });
    return chunks;
  }

  /**
   * Chunk content by paragraph boundaries
   */
  private chunkByParagraphs(content: string, maxTokens: number, charsPerToken: number): ContentChunk[] {
    const paragraphs = content.split(/\n\n+/);
    const chunks: ContentChunk[] = [];
    let currentChunk = '';
    let currentStart = 0;
    let chunkId = 0;
    let position = 0;

    for (const paragraph of paragraphs) {
      const paragraphTokens = this.estimateTokens(paragraph, charsPerToken);
      const currentChunkTokens = this.estimateTokens(currentChunk, charsPerToken);

      // If single paragraph exceeds limit, we have to include it anyway
      // (This is a fallback - in practice, we chunk before this happens)
      if (paragraphTokens > maxTokens && !currentChunk) {
        chunks.push({
          id: `chunk-${chunkId++}`,
          content: paragraph,
          heading: '',
          startPosition: position,
          endPosition: position + paragraph.length,
          tokenEstimate: paragraphTokens,
        });
        position += paragraph.length + 2; // +2 for \n\n
        continue;
      }

      // If adding this paragraph would exceed limit, flush current chunk
      if (currentChunk && currentChunkTokens + paragraphTokens > maxTokens) {
        chunks.push({
          id: `chunk-${chunkId++}`,
          content: currentChunk,
          heading: '',
          startPosition: currentStart,
          endPosition: position - 2, // -2 for \n\n before current paragraph
          tokenEstimate: currentChunkTokens,
        });
        currentChunk = '';
        currentStart = position;
      }

      // Add paragraph to current chunk
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      position += paragraph.length + 2;
    }

    // Flush final chunk
    if (currentChunk) {
      chunks.push({
        id: `chunk-${chunkId++}`,
        content: currentChunk,
        heading: '',
        startPosition: currentStart,
        endPosition: content.length,
        tokenEstimate: this.estimateTokens(currentChunk, charsPerToken),
      });
    }

    logger.info('Chunked by paragraphs', { chunkCount: chunks.length });
    return chunks;
  }

  /**
   * Hybrid chunking: Try headings first, fall back to paragraphs for large sections
   */
  private chunkHybrid(
    content: string,
    maxTokens: number,
    charsPerToken: number,
    preserveContext: boolean
  ): ContentChunk[] {
    const sections = this.parseHeadings(content);

    // If no headings found, fall back to paragraph chunking
    if (sections.length === 0 || (sections.length === 1 && !sections[0].heading)) {
      logger.info('No headings found, falling back to paragraph chunking');
      return this.chunkByParagraphs(content, maxTokens, charsPerToken);
    }

    // Use heading-based chunking
    return this.chunkByHeadings(content, maxTokens, charsPerToken, preserveContext);
  }

  /**
   * Parse markdown content to identify heading sections
   */
  private parseHeadings(content: string): Array<{
    heading: string;
    level: number;
    content: string;
    start: number;
    end: number;
  }> {
    const lines = content.split('\n');
    const sections: Array<{
      heading: string;
      level: number;
      content: string;
      start: number;
      end: number;
    }> = [];

    let currentSection: {
      heading: string;
      level: number;
      contentLines: string[];
      start: number;
    } | null = null;
    let position = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);

      if (headingMatch) {
        // Flush previous section
        if (currentSection) {
          const content = currentSection.contentLines.join('\n');
          sections.push({
            heading: currentSection.heading,
            level: currentSection.level,
            content,
            start: currentSection.start,
            end: position - 1, // -1 to not include newline before next heading
          });
        }

        // Start new section
        currentSection = {
          heading: headingMatch[2].trim(),
          level: headingMatch[1].length,
          contentLines: [line], // Include the heading line itself
          start: position,
        };
      } else if (currentSection) {
        // Add line to current section
        currentSection.contentLines.push(line);
      } else {
        // Content before first heading - treat as section with empty heading
        if (!currentSection) {
          currentSection = {
            heading: '',
            level: 0,
            contentLines: [line],
            start: 0,
          };
        }
      }

      position += line.length + 1; // +1 for newline
    }

    // Flush final section
    if (currentSection) {
      const content = currentSection.contentLines.join('\n');
      sections.push({
        heading: currentSection.heading,
        level: currentSection.level,
        content,
        start: currentSection.start,
        end: position,
      });
    }

    // If no sections found, return entire content as single section
    if (sections.length === 0) {
      sections.push({
        heading: '',
        level: 0,
        content,
        start: 0,
        end: content.length,
      });
    }

    logger.info('Parsed headings', {
      sectionCount: sections.length,
      headings: sections.map(s => ({ heading: s.heading, level: s.level }))
    });

    return sections;
  }

  /**
   * Estimate token count for content (instance method)
   */
  private estimateTokens(content: string, charsPerToken: number): number {
    return Math.ceil(content.length / charsPerToken);
  }

  /**
   * Static helper to estimate token count for content.
   * Uses conservative estimate of 4 characters per token.
   * @param content The content to estimate tokens for
   * @returns Estimated number of tokens
   */
  static estimateTokenCount(content: string): number {
    return Math.ceil(content.length / 4);
  }

  /**
   * Get summary statistics about chunks
   */
  getChunkStats(chunks: ContentChunk[]): {
    totalChunks: number;
    totalTokens: number;
    avgTokensPerChunk: number;
    minTokens: number;
    maxTokens: number;
  } {
    if (chunks.length === 0) {
      return {
        totalChunks: 0,
        totalTokens: 0,
        avgTokensPerChunk: 0,
        minTokens: 0,
        maxTokens: 0,
      };
    }

    const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0);
    const tokenCounts = chunks.map(c => c.tokenEstimate);

    return {
      totalChunks: chunks.length,
      totalTokens,
      avgTokensPerChunk: Math.round(totalTokens / chunks.length),
      minTokens: Math.min(...tokenCounts),
      maxTokens: Math.max(...tokenCounts),
    };
  }
}
