// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { UnifiedLLMClient } from '../../core/UnifiedLLMClient.js';
import type { TestCase, LLMJudgeResult, ValidationConfig } from './types.js';
import { createLogger } from '../../core/Logger.js';

const logger = createLogger('LLMEvaluator');

/**
 * LLM-based evaluator for judging tool output quality
 */
export class LLMEvaluator {
  private apiKey: string;
  private defaultModel: string;

  constructor(apiKey: string, defaultModel: string = 'gpt-4.1-mini') {
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
  }

  /**
   * Evaluate tool output using an LLM judge
   */
  async evaluate(
    output: any,
    testCase: TestCase,
    config: ValidationConfig
  ): Promise<LLMJudgeResult> {
    const llmConfig = config.llmJudge || { criteria: [], temperature: 0 };
    const model = llmConfig.model || this.defaultModel;
    const criteria = llmConfig.criteria || this.getDefaultCriteria(testCase);

    try {
      const prompt = this.buildEvaluationPrompt(output, testCase, criteria);
      
      const response = await UnifiedLLMClient.callLLM(
        this.apiKey,
        model,
        prompt,
        {
          systemPrompt: this.getSystemPrompt(),
          temperature: llmConfig.temperature ?? 0,
          responseFormat: { type: 'json_object' },
        }
      );

      return this.parseJudgment(response);
    } catch (error) {
      logger.error('[LLMEvaluator] Evaluation error:', error);
      return {
        passed: false,
        score: 0,
        issues: [`Evaluation failed: ${error instanceof Error ? error.message : String(error)}`],
        explanation: 'Failed to evaluate output',
      };
    }
  }

  /**
   * Get default evaluation criteria based on tool type
   */
  private getDefaultCriteria(testCase: TestCase): string[] {
    const criteria = [
      'The output is complete and contains meaningful data',
      'The output format is appropriate for the tool\'s purpose',
      'There are no obvious errors or missing required fields',
    ];

    // Add tool-specific criteria
    if (testCase.tool.includes('Extract')) {
      criteria.push('All requested data fields are extracted');
      criteria.push('Extracted data is accurate and properly formatted');
    }

    if (testCase.tool.includes('Navigate')) {
      criteria.push('Navigation was successful to the intended page');
    }

    if (testCase.tool.includes('Schema')) {
      criteria.push('Output conforms to the provided schema');
      criteria.push('All required fields are present');
    }

    return criteria;
  }

  /**
   * Build the evaluation prompt
   */
  private buildEvaluationPrompt(
    output: any,
    testCase: TestCase,
    criteria: string[]
  ): string {
    return `
You are evaluating the output of an AI tool execution.

TEST CASE: ${testCase.name}
TOOL: ${testCase.tool}
URL: ${testCase.url}
DESCRIPTION: ${testCase.description}

INPUT PROVIDED TO TOOL:
\`\`\`json
${JSON.stringify(testCase.input, null, 2)}
\`\`\`

TOOL OUTPUT:
\`\`\`json
${JSON.stringify(output, null, 2)}
\`\`\`

EVALUATION CRITERIA:
${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Please evaluate the tool output based on the criteria above. Consider:
1. Completeness: Does the output include all expected data?
2. Accuracy: Is the data correct and properly formatted?
3. Structure: Does it match the expected format?
4. Relevance: Is the output relevant to the input request?

IMPORTANT: Respond with ONLY a pure JSON object. Do not include any markdown formatting, code blocks, or explanatory text.

Required JSON format:
{
  "passed": boolean,
  "score": number (0-100),
  "dimensions": {
    "completeness": number (0-100),
    "accuracy": number (0-100),
    "structure": number (0-100),
    "relevance": number (0-100)
  },
  "issues": string[] (list of specific issues found, empty if none),
  "explanation": string (brief explanation of the evaluation),
  "confidence": number (0-100, your confidence in this evaluation)
}`;
  }

  /**
   * Get the system prompt for the LLM judge
   */
  private getSystemPrompt(): string {
    return `You are an expert evaluator for AI tool outputs. Your task is to objectively assess whether tool executions meet their intended purpose and quality standards. Be thorough but fair in your evaluation. Focus on practical utility rather than perfection. CRITICAL: Always respond with pure JSON only - no markdown code blocks, no explanatory text, no formatting.`;
  }

  /**
   * Parse the LLM's judgment response
   */
  private parseJudgment(response: string): LLMJudgeResult {
    let parsed: any;
    // First, try to parse the response as JSON directly
    try{
      parsed = JSON.parse(response); // Validate if response is already JSON
    } catch (error) {
      logger.error('[LLMEvaluator] Failed to parse judgment response:', error);
    }

    try {
      if (!parsed) {
        // Extract JSON from markdown code blocks if present
        let jsonString = response.trim();
        
        // Check for markdown code blocks
        const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
        const match = jsonString.match(codeBlockRegex);
        if (match) {
          jsonString = match[1].trim();
        }
        
        // Try to find JSON object if no code blocks
        if (!match) {
          const jsonStart = jsonString.indexOf('{');
          const jsonEnd = jsonString.lastIndexOf('}');
          if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
            jsonString = jsonString.substring(jsonStart, jsonEnd + 1);
          }
        }
        
        parsed = JSON.parse(jsonString);
      }
      
      // Validate the response structure
      if (typeof parsed.passed !== 'boolean' || typeof parsed.score !== 'number') {
        throw new Error('Invalid judgment format');
      }

      return {
        passed: parsed.passed,
        score: parsed.score,
        dimensions: parsed.dimensions || {
          completeness: parsed.score,
          accuracy: parsed.score,
          structure: parsed.score,
          relevance: parsed.score,
        },
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        explanation: parsed.explanation || 'No explanation provided',
        confidence: parsed.confidence,
      };
    } catch (error) {
      logger.error('[LLMEvaluator] Failed to parse judgment:', error);
      
      // Try to extract some meaning from the response
      const passed = response.toLowerCase().includes('passed') || 
                    response.toLowerCase().includes('success');
      
      return {
        passed,
        score: passed ? 75 : 25,
        issues: ['Failed to parse LLM judgment'],
        explanation: 'Judgment parsing failed, see raw response',
      };
    }
  }

  /**
   * Evaluate multiple outputs in batch
   */
  async evaluateBatch(
    results: Array<{ output: any; testCase: TestCase }>,
    config: ValidationConfig
  ): Promise<LLMJudgeResult[]> {
    const evaluations: LLMJudgeResult[] = [];

    for (const { output, testCase } of results) {
      logger.info('Evaluating ${testCase.id}...');
      const judgment = await this.evaluate(output, testCase, config);
      evaluations.push(judgment);
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return evaluations;
  }
}