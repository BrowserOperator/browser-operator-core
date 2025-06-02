// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type { Tool } from '../../tools/Tools.js';
import { NavigateURLTool } from '../../tools/Tools.js';
import type { TestCase, TestResult, EvaluationConfig } from './types.js';

/**
 * Generic evaluator that can test any tool without needing specific adapters
 */
export class GenericToolEvaluator {
  private navigateTool: NavigateURLTool;
  private config: EvaluationConfig;

  constructor(config: EvaluationConfig) {
    this.config = config;
    this.navigateTool = new NavigateURLTool();
  }

  /**
   * Run a test case for any tool
   */
  async runTest(testCase: TestCase, tool: Tool): Promise<TestResult> {
    const startTime = Date.now();

    try {
      console.log(`[GenericToolEvaluator] Starting test: ${testCase.name}`);
      console.log(`[GenericToolEvaluator] Tool: ${testCase.tool}, URL: ${testCase.url}`);

      // 1. Navigate to the URL if provided
      if (testCase.url) {
        const navResult = await this.navigateTool.execute({ url: testCase.url, reasoning: `Navigate to ${testCase.url} for test case ${testCase.name}` });
        if ('error' in navResult) {
          throw new Error(`Navigation failed: ${navResult.error}`);
        }
        // Wait for page to stabilize
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // 2. Execute the tool with the input
      const toolResult = await tool.execute(testCase.input);

      // 4. Extract success/failure and output
      const success = this.isSuccessfulResult(toolResult);
      const output = this.extractOutput(toolResult);
      const error = this.extractError(toolResult);

      return {
        testId: testCase.id,
        status: success ? 'passed' : 'failed',
        output,
        error,
        duration: Date.now() - startTime,
        timestamp: Date.now(),
        validation: {
          passed: success,
          summary: success 
            ? `Successfully executed ${testCase.tool}`
            : `${testCase.tool} execution failed: ${error}`,
        },
      };

    } catch (error) {
      console.error(`[GenericToolEvaluator] Test error:`, error);
      return {
        testId: testCase.id,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Run multiple tests sequentially
   */
  async runBatch(testCases: TestCase[], toolInstances: Map<string, Tool>): Promise<TestResult[]> {
    const results: TestResult[] = [];

    for (const testCase of testCases) {
      console.log(`[GenericToolEvaluator] Running test ${results.length + 1}/${testCases.length}`);
      
      const tool = toolInstances.get(testCase.tool);
      if (!tool) {
        throw new Error(`Tool instance not provided for: ${testCase.tool}`);
      }
      
      const result = await this.runTestWithRetries(testCase, tool);
      results.push(result);

      // Small delay between tests to avoid overwhelming the system
      if (results.length < testCases.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  /**
   * Run a test with retry logic
   */
  private async runTestWithRetries(testCase: TestCase, tool: Tool): Promise<TestResult> {
    const maxRetries = testCase.metadata.retries || this.config.retries || 1;
    let lastResult: TestResult | null = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        console.log(`[GenericToolEvaluator] Retry ${attempt}/${maxRetries} for ${testCase.id}`);
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }

      lastResult = await this.runTest(testCase, tool);
      
      // Only retry on errors, not on test failures
      if (lastResult.status !== 'error') {
        lastResult.retryCount = attempt;
        return lastResult;
      }
    }

    // Return the last error result
    return lastResult || {
      testId: testCase.id,
      status: 'error',
      error: 'No test execution attempted',
      duration: 0,
      timestamp: Date.now(),
      retryCount: maxRetries,
    };
  }

  /**
   * Determine if a tool result indicates success
   */
  private isSuccessfulResult(result: any): boolean {
    // Common success patterns across tools
    if (typeof result === 'object' && result !== null) {
      // Check for explicit success field
      if ('success' in result) {
        return Boolean(result.success);
      }
      // Check for error field (absence means success)
      if ('error' in result) {
        return !result.error;
      }
      // Check for status field
      if ('status' in result) {
        return result.status === 'success' || result.status === 'completed';
      }
    }
    // If we have a result at all, consider it successful
    return result !== null && result !== undefined;
  }

  /**
   * Extract the meaningful output from any tool result
   */
  private extractOutput(result: any): any {
    if (typeof result === 'object' && result !== null) {
      // Common output patterns
      if ('data' in result) return result.data;
      if ('output' in result) return result.output;
      if ('result' in result) return result.result;
      if ('value' in result) return result.value;
      
      // For tools that return success + other fields
      if ('success' in result) {
        const { success, error, ...output } = result;
        return output;
      }
    }
    return result;
  }

  /**
   * Extract error message from any tool result
   */
  private extractError(result: any): string | undefined {
    if (typeof result === 'object' && result !== null) {
      if ('error' in result && result.error) {
        return String(result.error);
      }
      if ('message' in result && result.message) {
        return String(result.message);
      }
      if ('reason' in result && result.reason) {
        return String(result.reason);
      }
    }
    return undefined;
  }

  /**
   * Sanitize output for snapshot comparison (static method for reusability)
   */
  static sanitizeOutput(output: any): any {
    const sanitized = JSON.parse(JSON.stringify(output));
    
    function sanitize(obj: any): void {
      if (!obj || typeof obj !== 'object') return;
      
      if (Array.isArray(obj)) {
        obj.forEach(sanitize);
        return;
      }

      for (const key in obj) {
        const value = obj[key];
        const lowerKey = key.toLowerCase();

        // Sanitize common dynamic fields
        if (lowerKey.includes('timestamp') || lowerKey.includes('time')) {
          obj[key] = '[TIMESTAMP]';
        } else if (lowerKey.includes('date')) {
          obj[key] = '[DATE]';
        } else if (lowerKey.includes('id') && typeof value === 'string') {
          obj[key] = '[ID]';
        } else if (lowerKey.includes('url') && typeof value === 'string') {
          try {
            const url = new URL(value);
            obj[key] = `${url.origin}${url.pathname}[PARAMS]`;
          } catch {
            obj[key] = value;
          }
        } else if (lowerKey.includes('price') && typeof value === 'number') {
          obj[key] = '[PRICE]';
        } else if (typeof value === 'object') {
          sanitize(value);
        }
      }
    }

    sanitize(sanitized);
    return sanitized;
  }
}