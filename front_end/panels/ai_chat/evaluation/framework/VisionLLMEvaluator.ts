// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type { TestCase, LLMJudgeResult } from './types.js';
import { createLogger } from '../../core/Logger.js';

const logger = createLogger('VisionLLMEvaluator');

/**
 * Content types for multimodal messages
 */
export type MessageContent = 
  | string 
  | Array<TextContent | ImageContent>;

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image_url';
  image_url: {
    url: string; // Can be URL or base64 data URL
    detail?: 'low' | 'high' | 'auto';
  };
}

export interface VisionMessage {
  role: 'system' | 'user' | 'assistant';
  content: MessageContent;
}

export interface ScreenshotData {
  dataUrl: string;
  timestamp: number;
  dimensions?: { width: number; height: number };
}

/**
 * LLM Evaluator with vision support for screenshot analysis
 */
export class VisionLLMEvaluator {
  
  /**
   * Check if a model supports vision (updated for latest models)
   */
  static isVisionModel(modelName: string): boolean {
    const visionModels = [
      // Latest GPT-4.1 family (April 2025)
      'gpt-4.1',
      'gpt-4.1-mini', 
      'gpt-4.1-nano',
      // GPT-4o series
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4o-2024-08-06',
      'gpt-4o-2024-05-13',
      'gpt-4o-mini-2024-07-18',
      // GPT-4 Turbo with Vision
      'gpt-4-turbo',
      'gpt-4-turbo-2024-04-09',
      'gpt-4-turbo-preview',
      // O-series reasoning models
      'o1-preview',
      'o1-mini',
      // Legacy
      'gpt-4-vision-preview',
    ];
    
    return visionModels.some(model => modelName.toLowerCase().includes(model.toLowerCase()));
  }

  /**
   * Evaluate test results with optional screenshot analysis
   */
  static async evaluateWithScreenshots(
    output: any,
    testCase: TestCase,
    screenshots?: {
      before?: ScreenshotData;
      after?: ScreenshotData;
    }
  ): Promise<LLMJudgeResult> {
    
    const apiKey = localStorage.getItem('ai_chat_api_key');
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const modelName = localStorage.getItem('ai_chat_model') || 'gpt-4.1-mini';
    
    // Check if we have screenshots and model supports vision
    const hasScreenshots = Boolean(screenshots && (screenshots.before || screenshots.after));
    const canUseVision = this.isVisionModel(modelName) && hasScreenshots;

    logger.info(`VisionLLMEvaluator: Using model ${modelName}, Vision capable: ${canUseVision}`);

    // Build the evaluation prompt
    const basePrompt = this.buildEvaluationPrompt(output, testCase);
    
    let messages: VisionMessage[];

    if (canUseVision) {
      // Create multimodal message with screenshots
      messages = this.buildVisionMessages(basePrompt, testCase, screenshots!);
    } else {
      // Fallback to text-only evaluation
      messages = [
        {
          role: 'system',
          content: 'You are an expert evaluator of browser automation tasks. Analyze the provided information and determine if the action was successful.'
        },
        {
          role: 'user',
          content: basePrompt
        }
      ];
    }

    try {
      // Call OpenAI API with vision support
      const response = await this.callVisionAPI(apiKey, modelName, messages);
      
      // Parse the evaluation result
      return this.parseEvaluationResponse(response, canUseVision);
      
    } catch (error) {
      logger.error('Vision LLM evaluation failed:', error);
      throw error;
    }
  }

  /**
   * Build vision-enabled messages with screenshots
   */
  private static buildVisionMessages(
    basePrompt: string, 
    testCase: TestCase, 
    screenshots: { before?: ScreenshotData; after?: ScreenshotData }
  ): VisionMessage[] {
    
    const content: Array<TextContent | ImageContent> = [
      {
        type: 'text',
        text: basePrompt + '\n\nVisual Analysis Instructions:\n' +
              '- Analyze the provided screenshots to verify the action was completed\n' +
              '- Look for visual changes that indicate success (button states, form values, page navigation, etc.)\n' +
              '- Check for error messages, loading states, or unexpected UI changes\n' +
              '- Compare before/after states if both screenshots are provided\n' +
              '- Provide specific visual evidence in your evaluation'
      }
    ];

    // Add before screenshot if available
    if (screenshots.before) {
      content.push({
        type: 'text',
        text: '\n--- BEFORE ACTION SCREENSHOT ---'
      });
      content.push({
        type: 'image_url',
        image_url: {
          url: screenshots.before.dataUrl,
          detail: 'high' // Use high detail for better accuracy
        }
      });
    }

    // Add after screenshot if available
    if (screenshots.after) {
      content.push({
        type: 'text',
        text: '\n--- AFTER ACTION SCREENSHOT ---'
      });
      content.push({
        type: 'image_url',
        image_url: {
          url: screenshots.after.dataUrl,
          detail: 'high'
        }
      });
    }

    return [
      {
        role: 'system',
        content: 'You are an expert evaluator of browser automation tasks with visual analysis capabilities. ' +
                'Analyze both the text logs and screenshots to determine if the browser action was successful. ' +
                'Pay special attention to visual evidence of success or failure.'
      },
      {
        role: 'user',
        content
      }
    ];
  }

  /**
   * Build the base evaluation prompt
   */
  private static buildEvaluationPrompt(output: any, testCase: TestCase): string {
    const criteria = testCase.validation.llmJudge?.criteria || [];
    
    return `
Task: Evaluate if this browser automation action was successful.

Objective: ${testCase.input.objective || testCase.description}
Expected URL: ${testCase.url}

Action Output:
${JSON.stringify(output, null, 2)}

Evaluation Criteria:
${criteria.map((criterion, i) => `${i + 1}. ${criterion}`).join('\n')}

Please evaluate the action and provide:
1. A score from 0-100 (100 = completely successful)
2. Whether the action PASSED or FAILED overall
3. Detailed explanation of your reasoning
4. Any issues or concerns identified
5. If screenshots are provided, specific visual evidence

Respond in this JSON format:
{
  "score": <number 0-100>,
  "passed": <boolean>,
  "explanation": "<detailed reasoning>",
  "issues": ["<issue1>", "<issue2>"],
  "visualEvidence": "<description of visual confirmation if screenshots provided>"
}`;
  }

  /**
   * Call OpenAI API with vision support
   */
  private static async callVisionAPI(
    apiKey: string,
    modelName: string,
    messages: VisionMessage[]
  ): Promise<any> {
    
    const payload = {
      model: modelName,
      messages: messages,
      max_tokens: 1000,
      temperature: 0.1,
      response_format: { type: 'json_object' }
    };

    logger.info('Calling OpenAI Vision API with payload:', {
      model: payload.model,
      messageCount: messages.length,
      hasImages: messages.some(m => 
        Array.isArray(m.content) && 
        m.content.some(c => c.type === 'image_url')
      )
    });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`OpenAI API error: ${response.statusText} - ${errorData?.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    
    if (data.usage) {
      logger.info('Token usage:', data.usage);
    }

    return data;
  }

  /**
   * Parse the LLM evaluation response
   */
  private static parseEvaluationResponse(response: any, usedVision: boolean): LLMJudgeResult {
    try {
      const content = response.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('No content in response');
      }

      const parsed = JSON.parse(content);
      
      return {
        passed: parsed.passed === true,
        score: Math.max(0, Math.min(100, parsed.score || 0)),
        explanation: parsed.explanation || 'No explanation provided',
        confidence: usedVision ? 90 : 70, // Higher confidence with visual verification
        dimensions: {
          completeness: parsed.score || 0,
          accuracy: parsed.score || 0,
          structure: parsed.score || 0,
          relevance: parsed.score || 0
        },
        issues: parsed.issues || [],
        visualEvidence: parsed.visualEvidence
      };
      
    } catch (error) {
      logger.error('Failed to parse evaluation response:', error);
      return {
        passed: false,
        score: 0,
        explanation: `Failed to parse evaluation: ${error}`,
        confidence: 10
      };
    }
  }
}