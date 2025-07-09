// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type { Tool } from './Tools.js';
import { createLogger } from '../core/Logger.js';
import { CritiqueTool } from './CritiqueTool.js';
import { AgentService } from '../core/AgentService.js';
import { ChatMessageEntity } from '../ui/ChatView.js';

const logger = createLogger('Tool:MarkdownRenderer');

export interface MarkdownRendererArgs {
  content: string;
  title?: string;
  format?: 'inline' | 'document' | 'auto';
  metadata?: {
    author?: string;
    date?: string;
    tags?: string[];
  };
  isFinalAnswer?: boolean;
  reasoning?: string;
}

export interface MarkdownRendererResult {
  success: boolean;
  rendered: boolean;
  format: 'inline' | 'document';
  content: string;
  error?: string;
  // Critique results (when isFinalAnswer is true)
  critiqued?: boolean;
  accepted?: boolean;
  feedback?: string;
}

export class MarkdownRendererTool implements Tool<MarkdownRendererArgs, MarkdownRendererResult> {
  name = 'render_markdown';
  
  description = `Renders markdown content with proper formatting. Can display inline in chat or as a full document.
  Use 'inline' for short content, 'document' for reports/articles, or 'auto' to decide based on content length.
  Set isFinalAnswer=true to enable critique validation against user requirements before rendering.`;
  
  schema = {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The markdown content to render'
      },
      title: {
        type: 'string',
        description: 'Optional title for the document'
      },
      format: {
        type: 'string',
        enum: ['inline', 'document', 'auto'],
        description: 'How to display the content (default: auto)'
      },
      metadata: {
        type: 'object',
        properties: {
          author: { type: 'string' },
          date: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } }
        },
        description: 'Optional metadata for the document'
      },
      isFinalAnswer: {
        type: 'boolean',
        description: 'Whether this is a final answer that should be critiqued against user requirements'
      },
      reasoning: {
        type: 'string',
        description: 'Brief reasoning abut the markdown content'
      }
    },
    required: ['content']
  };

  async execute(args: MarkdownRendererArgs): Promise<MarkdownRendererResult> {
    // Add tracing observation
    await this.createToolTracingObservation(this.name, args);
    
    try {
      const { content, title, format = 'auto', metadata, isFinalAnswer = false, reasoning } = args;
      
      logger.info('Executing markdown renderer', { 
        contentLength: content.length, 
        hasTitle: !!title, 
        format,
        hasMetadata: !!metadata,
        isFinalAnswer 
      });
      
      // If this is a final answer, perform critique first
      let critiqueResult = null;
      if (isFinalAnswer) {
        critiqueResult = await this.performCritique(content, reasoning);
        logger.info('Critique result:', critiqueResult);
        
        // If critique failed and we have feedback, return it
        if (!critiqueResult.accepted && critiqueResult.feedback) {
          return {
            success: true,
            rendered: false,
            format: 'inline',
            content: critiqueResult.feedback,
            critiqued: true,
            accepted: false,
            feedback: critiqueResult.feedback
          };
        }
      }
      
      // Determine rendering format
      const renderFormat = this.determineFormat(content, format);
      logger.info('Determined render format:', renderFormat);
      
      // Prepare the markdown content
      let finalContent = content;
      
      // Add title if provided
      if (title) {
        finalContent = `# ${title}\n\n${finalContent}`;
      }
      
      // Add metadata if provided
      if (metadata) {
        const metadataSection = this.formatMetadata(metadata);
        if (metadataSection) {
          finalContent = `${metadataSection}\n\n---\n\n${finalContent}`;
        }
      }
      
      // For document format, wrap in XML tags for ChatView processing
      if (renderFormat === 'document') {
        // Use provided reasoning or default message
        const reasoningText = reasoning || 'Rendering markdown content as requested.';
        
        return {
          success: true,
          rendered: true,
          format: 'document',
          content: `<reasoning>${reasoningText}</reasoning>\n<markdown_report>${finalContent}</markdown_report>`,
          critiqued: isFinalAnswer,
          accepted: critiqueResult?.accepted ?? true
        };
      }
      
      // For inline format, return plain markdown
      return {
        success: true,
        rendered: true,
        format: 'inline',
        content: finalContent,
        critiqued: isFinalAnswer,
        accepted: critiqueResult?.accepted ?? true
      };
      
    } catch (error: any) {
      logger.error('Error rendering markdown:', error);
      return {
        success: false,
        rendered: false,
        format: 'inline',
        content: '',
        error: error.message
      };
    }
  }
  
  private determineFormat(content: string, requestedFormat: string): 'inline' | 'document' {
    if (requestedFormat !== 'auto') {
      return requestedFormat as 'inline' | 'document';
    }
    
    // Auto-detect based on content characteristics
    const lines = content.split('\n').length;
    const length = content.length;
    const hasMultipleHeadings = (content.match(/^#{1,6}\s+/gm) || []).length > 2;
    const hasCodeBlocks = content.includes('```');
    const hasTables = content.includes('|') && content.includes('---');
    
    // Use document format for complex or long content
    if (length > 1000 || lines > 30 || hasMultipleHeadings || (hasCodeBlocks && hasTables)) {
      return 'document';
    }
    
    return 'inline';
  }
  
  private formatMetadata(metadata: any): string {
    const parts: string[] = [];
    
    if (metadata.author) {
      parts.push(`**Author:** ${metadata.author}`);
    }
    
    if (metadata.date) {
      parts.push(`**Date:** ${metadata.date}`);
    }
    
    if (metadata.tags && metadata.tags.length > 0) {
      parts.push(`**Tags:** ${metadata.tags.join(', ')}`);
    }
    
    return parts.join('  \n');
  }
  
  private async performCritique(content: string, reasoning?: string): Promise<{accepted: boolean, feedback?: string}> {
    try {
      // Get the current state from AgentService  
      const agentService = AgentService.getInstance();
      const state = agentService.getState();
      const apiKey = agentService.getApiKey();

      if (!state?.messages || state.messages.length === 0) {
        logger.warn('No state or messages available for critique, accepting by default');
        return { accepted: true };
      }

      if (!apiKey) {
        logger.warn('No API key available for critique, accepting by default');
        return { accepted: true };
      }

      // Find the last user message to use as evaluation criteria
      const lastUserMessage = this.findLastMessage(state.messages, ChatMessageEntity.USER);
      if (!lastUserMessage) {
        logger.warn('No user message found for critique, accepting by default');
        return { accepted: true };
      }

      // Format the answer for critique
      const formattedAnswer = reasoning ? 
        `<reasoning>${reasoning}</reasoning>\n<markdown_report>${content}</markdown_report>` :
        content;

      // Call the critique tool
      const critiqueTool = new CritiqueTool();
      const critiqueResult = await critiqueTool.execute({
        userInput: lastUserMessage.text || '',
        finalResponse: formattedAnswer,
        reasoning: 'Evaluating final research report for completeness and alignment with user requirements'
      });

      if (critiqueResult.success) {
        return {
          accepted: critiqueResult.satisfiesCriteria || false,
          feedback: critiqueResult.feedback
        };
      } else {
        logger.error('Critique tool failed:', critiqueResult.error);
        return { accepted: true }; // Accept by default if critique fails
      }

    } catch (error: any) {
      logger.error('Error during critique:', error);
      return { accepted: true }; // Accept by default if critique throws
    }
  }

  private findLastMessage(messages: any[], entityType: ChatMessageEntity): any | undefined {
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return undefined;
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message && message.entity === entityType) {
        return message;
      }
    }

    return undefined;
  }
  
  private async createToolTracingObservation(toolName: string, args: any): Promise<void> {
    try {
      const { getCurrentTracingContext, createTracingProvider } = await import('../tracing/TracingConfig.js');
      const context = getCurrentTracingContext();
      if (context) {
        const tracingProvider = createTracingProvider();
        await tracingProvider.createObservation({
          id: `event-tool-execute-${toolName}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          name: `Tool Execute: ${toolName}`,
          type: 'event',
          startTime: new Date(),
          input: { 
            toolName, 
            toolArgs: args,
            contextInfo: `Direct tool execution in ${toolName}`
          },
          metadata: {
            executionPath: 'direct-tool',
            toolName
          }
        }, context.traceId);
      }
    } catch (tracingError) {
      // Don't fail tool execution due to tracing errors
      console.error(`[TRACING ERROR in ${toolName}]`, tracingError);
    }
  }
}