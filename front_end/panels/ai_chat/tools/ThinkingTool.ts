// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as SDK from '../../../core/sdk/sdk.js';
import type { Tool } from './Tools.js';
import { TakeScreenshotTool } from './Tools.js';
import { createLogger } from '../core/Logger.js';
import { LLMClient } from '../LLM/LLMClient.js';
import { AIChatPanel } from '../ui/AIChatPanel.js';

const logger = createLogger('ThinkingTool');

/**
 * Interface for thinking result with flexible structure
 */
export interface ThinkingResult {
  visualSummary: string;
  thingsToDoList: string[];
  currentProgress?: string;
  observations?: string;
}

/**
 * Interface for thinking arguments
 */
export interface ThinkingArgs {
  userRequest: string;
  context?: string;
}

/**
 * Tool for high-level thinking and planning with visual context
 */
export class ThinkingTool implements Tool<ThinkingArgs, ThinkingResult | { error: string }> {
  name = 'thinking';
  description = 'A flexible thinking tool that provides a high-level visual summary and creates an unstructured list of things to do. Useful for getting oriented, planning next steps, or reflecting on current state.';

  private screenshotTool = new TakeScreenshotTool();

  async execute(args: ThinkingArgs): Promise<ThinkingResult | { error: string }> {
    try {
      logger.info('Thinking tool initiated', { userRequest: args.userRequest });

      // 1. Capture current visual state
      const visualContext = await this.captureVisualContext();
      if ('error' in visualContext) {
        return { error: `Failed to capture visual context: ${visualContext.error}` };
      }

      // 2. Build thinking prompt
      const prompt = this.buildThinkingPrompt(args.userRequest, args.context, visualContext);

      // 3. Get thinking analysis
      const analysis = await this.getThinkingAnalysis(prompt);
      if ('error' in analysis) {
        return { error: `Failed to analyze: ${analysis.error}` };
      }

      return analysis;
    } catch (error) {
      logger.error('Thinking tool failed:', error);
      return { error: `Thinking failed: ${String(error)}` };
    }
  }

  private async captureVisualContext(): Promise<{ screenshot: string; url: string; title: string } | { error: string }> {
    try {
      // Take screenshot
      const screenshotResult = await this.screenshotTool.execute({ fullPage: false });
      if ('error' in screenshotResult) {
        return { error: `Screenshot failed: ${screenshotResult.error}` };
      }

      // Get page metadata
      const target = SDK.TargetManager.TargetManager.instance().primaryPageTarget();
      if (!target) {
        return { error: 'No page target available' };
      }

      const url = target.inspectedURL();
      const titleResult = await target.runtimeAgent().invoke_evaluate({
        expression: 'document.title',
        returnByValue: true,
      });
      const title = titleResult.result?.value || 'Untitled';

      return {
        screenshot: screenshotResult.imageData || '',
        url,
        title
      };
    } catch (error) {
      return { error: `Failed to capture visual context: ${String(error)}` };
    }
  }

  private buildThinkingPrompt(
    userRequest: string,
    context: string | undefined,
    visualContext: { screenshot: string; url: string; title: string }
  ): { systemPrompt: string; userPrompt: string; images: Array<{ type: string; data: string }> } {
    const systemPrompt = `You are a thinking tool that helps with high-level planning and visual analysis. Your job is to look at the current state and think through what needs to be done in a flexible, unstructured way, always staying focused on the user's original request.

APPROACH:
1. Describe what you see in the screenshot in a brief, useful way
2. Create a flexible list of things that might need to be done (not rigid steps) to accomplish the user's request
3. Think about current progress toward the user's goal and what to focus on next
4. Be conversational and adaptive, not overly structured

OUTPUT FORMAT:
{
  "visualSummary": "Brief description of what you see that's relevant to the context",
  "thingsToDoList": ["High-level thing 1", "High-level thing 2", "Maybe this other thing", "Check on this", "Consider doing that"],
  "currentProgress": "Optional - where things stand right now toward the user's goal",
  "observations": "Optional - any interesting observations or notes"
}

Keep it conversational and flexible. Don't make it overly structured or rigid. Always keep the user's request in mind.`;

    const contextSection = context ? `\nADDITIONAL CONTEXT: ${context}` : '';

    const userPrompt = `USER REQUEST: ${userRequest}

CONTEXT: ${contextSection}

CURRENT PAGE: ${visualContext.title}

Look at the screenshot and think through what needs to be done to accomplish the user's request. Create a high-level visual summary and a flexible list of things to consider or work on.`;

    return {
      systemPrompt,
      userPrompt,
      images: [{
        type: 'image_url',
        data: visualContext.screenshot
      }]
    };
  }

  private async getThinkingAnalysis(prompt: { systemPrompt: string; userPrompt: string; images: Array<{ type: string; data: string }> }): Promise<ThinkingResult | { error: string }> {
    try {
      // Get the selected model and its provider
      const model = AIChatPanel.instance().getSelectedModel();
      const provider = AIChatPanel.getProviderForModel(model);
      const llm = LLMClient.getInstance();

      // Prepare multimodal message
      const messages = [{
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: prompt.userPrompt },
          ...prompt.images.map(img => ({
            type: 'image_url' as const,
            image_url: { url: img.data }
          }))
        ]
      }];

      const response = await llm.call({
        provider,
        model,
        messages,
        systemPrompt: prompt.systemPrompt,
        temperature: 0.3
      });

      if (!response.text) {
        return { error: 'No response from LLM' };
      }

      try {
        const result = JSON.parse(response.text) as ThinkingResult;

        // Validate result structure
        if (!result.visualSummary || !result.thingsToDoList || !Array.isArray(result.thingsToDoList)) {
          return { error: 'Invalid response structure from LLM' };
        }

        return result;
      } catch (parseError) {
        logger.error('Failed to parse LLM response:', parseError);
        return { error: `Failed to parse response: ${String(parseError)}` };
      }
    } catch (error) {
      logger.error('LLM call failed:', error);
      return { error: `LLM analysis failed: ${String(error)}` };
    }
  }

  schema = {
    type: 'object',
    properties: {
      userRequest: {
        type: 'string',
        description: 'The original user request or goal to think about'
      },
      context: {
        type: 'string',
        description: 'Optional additional context about the current situation'
      }
    },
    required: ['userRequest']
  };
}
