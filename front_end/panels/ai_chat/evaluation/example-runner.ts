// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { GenericToolEvaluator } from './framework/GenericToolEvaluator.js';
import { LLMEvaluator } from './framework/LLMEvaluator.js';
import { AgentService } from '../core/AgentService.js';
import { SchemaBasedExtractorTool } from '../tools/SchemaBasedExtractorTool.js';
import { schemaExtractorTests, simpleTest } from './test-cases/schema-extractor-tests.js';
import type { EvaluationConfig, TestResult } from './framework/types.js';

/**
 * Example runner for the evaluation framework
 */
export class EvaluationRunner {
  private evaluator: GenericToolEvaluator;
  private llmEvaluator: LLMEvaluator;
  private config: EvaluationConfig;

  constructor() {
    // Get API key from AgentService
    const agentService = AgentService.getInstance();
    const apiKey = agentService.getApiKey();
    
    if (!apiKey) {
      throw new Error('API key not configured. Please configure in AI Chat settings.');
    }

    this.config = {
      extractionModel: 'gpt-4.1-mini',
      extractionApiKey: apiKey,
      evaluationModel: 'gpt-4.1-mini',
      evaluationApiKey: apiKey,
      maxConcurrency: 1,
      timeoutMs: 60000,
      retries: 2,
      snapshotDir: './snapshots',
      reportDir: './reports'
    };

    this.evaluator = new GenericToolEvaluator(this.config);
    this.llmEvaluator = new LLMEvaluator(this.config.evaluationApiKey, this.config.evaluationModel);
  }

  /**
   * Run a single test case
   */
  async runSingleTest(testId?: string): Promise<TestResult> {
    const testCase = testId ? 
      schemaExtractorTests.find(t => t.id === testId) || simpleTest :
      simpleTest;

    console.log(`[EvaluationRunner] Running test: ${testCase.name}`);
    console.log(`[EvaluationRunner] URL: ${testCase.url}`);

    // Create the tool instance
    const tool = new SchemaBasedExtractorTool();
    const result = await this.evaluator.runTest(testCase, tool as any);
    
    // Add LLM evaluation if test passed
    if (result.status === 'passed' && result.output && testCase.validation.type !== 'snapshot') {
      console.log(`[EvaluationRunner] Adding LLM evaluation...`);
      
      try {
        const llmJudgment = await this.llmEvaluator.evaluate(
          result.output,
          testCase,
          testCase.validation
        );
        
        if (result.validation) {
          result.validation.llmJudge = llmJudgment;
          result.validation.passed = result.validation.passed && llmJudgment.passed;
          result.validation.summary += ` | LLM Score: ${llmJudgment.score}/100`;
        }
      } catch (error) {
        console.warn('[EvaluationRunner] LLM evaluation failed:', error);
      }
    }

    this.printTestResult(result);
    return result;
  }

  /**
   * Run all tests
   */
  async runAllTests(): Promise<TestResult[]> {
    console.log(`[EvaluationRunner] Running ${schemaExtractorTests.length} tests...`);
    
    // Create tool instances map
    const toolInstances = new Map();
    toolInstances.set('extract_schema_data', new SchemaBasedExtractorTool() as any);
    
    const results = await this.evaluator.runBatch(schemaExtractorTests, toolInstances);
    
    // Add LLM evaluations
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const testCase = schemaExtractorTests[i];
      
      if (result.status === 'passed' && result.output && testCase.validation.type !== 'snapshot') {
        try {
          const llmJudgment = await this.llmEvaluator.evaluate(
            result.output,
            testCase,
            testCase.validation
          );
          
          if (result.validation) {
            result.validation.llmJudge = llmJudgment;
            result.validation.passed = result.validation.passed && llmJudgment.passed;
          }
        } catch (error) {
          console.warn(`[EvaluationRunner] LLM evaluation failed for ${testCase.id}:`, error);
        }
      }
    }

    this.printSummary(results);
    return results;
  }

  /**
   * Print test result
   */
  private printTestResult(result: TestResult): void {
    console.log('\n' + '='.repeat(60));
    console.log(`Test: ${result.testId}`);
    console.log(`Status: ${result.status.toUpperCase()}`);
    console.log(`Duration: ${result.duration}ms`);
    
    if (result.error) {
      console.log(`Error: ${result.error}`);
    }
    
    if (result.validation) {
      console.log(`Validation: ${result.validation.passed ? 'PASSED' : 'FAILED'}`);
      console.log(`Summary: ${result.validation.summary}`);
      
      if (result.validation.llmJudge) {
        const judge = result.validation.llmJudge;
        console.log(`LLM Score: ${judge.score}/100`);
        console.log(`Explanation: ${judge.explanation}`);
        
        if (judge.issues && judge.issues.length > 0) {
          console.log(`Issues: ${judge.issues.join(', ')}`);
        }
      }
    }
    
    if (result.output && result.status === 'passed') {
      console.log('\nOutput Preview:');
      const preview = JSON.stringify(result.output, null, 2);
      console.log(preview.length > 500 ? preview.substring(0, 500) + '...' : preview);
    }
    
    console.log('='.repeat(60));
  }

  /**
   * Print summary of all results
   */
  private printSummary(results: TestResult[]): void {
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const errors = results.filter(r => r.status === 'error').length;
    
    const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
    
    console.log('\n' + '='.repeat(60));
    console.log('EVALUATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total Tests: ${results.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Errors: ${errors}`);
    console.log(`Average Duration: ${Math.round(avgDuration)}ms`);
    console.log(`Success Rate: ${Math.round((passed / results.length) * 100)}%`);
    
    // LLM Judge statistics
    const withLLMJudge = results.filter(r => r.validation?.llmJudge);
    if (withLLMJudge.length > 0) {
      const avgScore = withLLMJudge.reduce(
        (sum, r) => sum + (r.validation?.llmJudge?.score || 0), 
        0
      ) / withLLMJudge.length;
      console.log(`Average LLM Score: ${Math.round(avgScore)}/100`);
    }
    
    console.log('='.repeat(60));
  }

  /**
   * Quick test method for development
   */
  static async quickTest(): Promise<void> {
    try {
      const runner = new EvaluationRunner();
      await runner.runSingleTest('github-repo-001');
    } catch (error) {
      console.error('[EvaluationRunner] Quick test failed:', error);
    }
  }
}

// Export for easy access in DevTools console
(globalThis as any).EvaluationRunner = EvaluationRunner;