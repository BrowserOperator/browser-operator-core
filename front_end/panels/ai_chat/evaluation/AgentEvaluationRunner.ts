// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { GenericToolEvaluator } from './framework/GenericToolEvaluator.js';
import { LLMEvaluator } from './framework/LLMEvaluator.js';
import { AgentService } from '../core/AgentService.js';
import { ToolRegistry } from '../agent_framework/ConfigurableAgentTool.js';
import type { EvaluationConfig, TestResult, TestCase, ValidationConfig } from './framework/types.js';

/**
 * Enhanced conversation info for agent tools
 */
export interface AgentConversationInfo {
  toolsUsed: string[];
  stepCount: number;
  handoffOccurred: boolean;
  handoffTarget?: string;
  iterations: number;
  researchSources?: string[];
  errorCount: number;
  finalStatus: string;
}

/**
 * Generic evaluation runner for all agent tools (ConfigurableAgentTool instances)
 */
export class AgentEvaluationRunner {
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
      maxConcurrency: 1, // Agent tools should run sequentially
      timeoutMs: 300000, // 5 minutes default for agent tools
      retries: 2,
      snapshotDir: './snapshots/agents',
      reportDir: './reports/agents'
    };

    this.evaluator = new GenericToolEvaluator(this.config);
    this.llmEvaluator = new LLMEvaluator(this.config.evaluationApiKey, this.config.evaluationModel);
  }

  /**
   * Run a single agent test case
   */
  async runSingleTest<T = any>(testCase: TestCase<T>, agentName?: string): Promise<TestResult> {
    const toolName = agentName || testCase.tool;
    
    console.log(`[AgentEvaluationRunner] Running test: ${testCase.name}`);
    console.log(`[AgentEvaluationRunner] Agent: ${toolName}`);
    console.log(`[AgentEvaluationRunner] Expected timeout: ${testCase.metadata.timeout || this.config.timeoutMs}ms`);

    // Get the agent from ToolRegistry
    const agent = ToolRegistry.getRegisteredTool(toolName);
    if (!agent) {
      throw new Error(`Agent "${toolName}" not found in ToolRegistry. Ensure it is properly registered.`);
    }

    const result = await this.evaluator.runTest(testCase, agent as any);
    
    // Add specialized LLM evaluation for agent results
    if (result.status === 'passed' && result.output && testCase.validation.type !== 'snapshot') {
      console.log(`[AgentEvaluationRunner] Adding specialized agent evaluation...`);
      
      try {
        const llmJudgment = await this.evaluateAgentResult(
          result.output,
          testCase,
          testCase.validation
        );
        
        if (result.validation) {
          result.validation.llmJudge = llmJudgment;
          result.validation.passed = result.validation.passed && llmJudgment.passed;
          result.validation.summary += ` | Agent Score: ${llmJudgment.score}/100`;
        }
      } catch (error) {
        console.warn('[AgentEvaluationRunner] Agent evaluation failed:', error);
      }
    }

    this.printAgentTestResult(result);
    return result;
  }

  /**
   * Run a batch of agent tests
   */
  async runTestBatch<T = any>(testCases: TestCase<T>[], agentName?: string): Promise<TestResult[]> {
    const results: TestResult[] = [];
    
    console.log(`[AgentEvaluationRunner] Running ${testCases.length} agent tests...`);
    
    // Get the agent once if specified
    let agent = null;
    if (agentName) {
      agent = ToolRegistry.getRegisteredTool(agentName);
      if (!agent) {
        throw new Error(`Agent "${agentName}" not found in ToolRegistry.`);
      }
    }

    // Run tests sequentially for agent tools (they may interfere with each other)
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      const toolName = agentName || testCase.tool;
      
      console.log(`[AgentEvaluationRunner] Running test ${i + 1}/${testCases.length}: ${testCase.name}`);
      
      // Get agent for this specific test if not using a fixed agent
      const testAgent = agent || ToolRegistry.getRegisteredTool(toolName);
      if (!testAgent) {
        console.error(`[AgentEvaluationRunner] Agent "${toolName}" not found, skipping test`);
        results.push({
          testId: testCase.id,
          status: 'error',
          error: `Agent "${toolName}" not found in ToolRegistry`,
          duration: 0,
          timestamp: Date.now()
        });
        continue;
      }
      
      const result = await this.evaluator.runTest(testCase, testAgent as any);
      
      // Add specialized agent evaluation
      if (result.status === 'passed' && result.output && testCase.validation.type !== 'snapshot') {
        try {
          const llmJudgment = await this.evaluateAgentResult(
            result.output,
            testCase,
            testCase.validation
          );
          
          if (result.validation) {
            result.validation.llmJudge = llmJudgment;
            result.validation.passed = result.validation.passed && llmJudgment.passed;
          }
        } catch (error) {
          console.warn(`[AgentEvaluationRunner] Agent evaluation failed for ${testCase.id}:`, error);
        }
      }

      results.push(result);
      
      // Longer delay between agent tests to allow cleanup
      if (i < testCases.length - 1) {
        console.log('[AgentEvaluationRunner] Waiting between tests...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    this.printAgentSummary(results);
    return results;
  }

  /**
   * Specialized evaluation for agent results with enhanced criteria
   */
  private async evaluateAgentResult(
    output: any,
    testCase: TestCase,
    inputValidationConfig: ValidationConfig
  ): Promise<any> {
    // Extract conversation history and tool usage if available
    const conversationInfo = this.extractConversationInfo(output);
    
    // Create enhanced evaluation prompt for agent results
    const enhancedCriteria = [
      ...inputValidationConfig.llmJudge?.criteria || [],
      'Agent demonstrated autonomous decision-making and logical progression',
      'Tool usage was appropriate and effective for the given task',
      'Agent showed ability to adapt strategy based on intermediate results',
      'Final output represents a meaningful completion of the requested task'
    ];

    // Add tool-specific criteria if tools were detected
    if (conversationInfo.toolsUsed.length > 0) {
      enhancedCriteria.push(
        `Agent effectively utilized available tools: ${conversationInfo.toolsUsed.join(', ')}`
      );
    }

    // Add handoff criteria if handoff was expected or occurred
    if (conversationInfo.handoffOccurred) {
      enhancedCriteria.push('Agent properly executed handoff to another agent when appropriate');
    }

    const enhancedValidation = {
      ...inputValidationConfig.llmJudge,
      criteria: enhancedCriteria
    };

    // Include conversation metadata in evaluation
    const evaluationContext = {
      input: testCase.input,
      output: output,
      conversationInfo: conversationInfo,
      testCase: testCase
    };

    const validationConfig: ValidationConfig = {
      type: 'llm-judge',
      llmJudge: enhancedValidation
    };

    return this.llmEvaluator.evaluate(
      evaluationContext,
      testCase,
      validationConfig
    );
  }

  /**
   * Extract comprehensive conversation and tool usage information from agent output
   */
  extractConversationInfo(output: any): AgentConversationInfo {
    const info: AgentConversationInfo = {
      toolsUsed: [],
      stepCount: 0,
      handoffOccurred: false,
      iterations: 0,
      researchSources: [],
      errorCount: 0,
      finalStatus: 'unknown'
    };

    if (!output || typeof output !== 'object') {
      return info;
    }

    // Extract from conversation messages (standard ConfigurableAgentTool format)
    if (output.messages && Array.isArray(output.messages)) {
      info.stepCount = output.messages.length;
      
      // Count assistant messages for iterations
      info.iterations = output.messages.filter((msg: any) => msg.role === 'assistant').length;
      
      // Extract tool usage from messages
      for (const message of output.messages) {
        if (message.tool_calls && Array.isArray(message.tool_calls)) {
          for (const toolCall of message.tool_calls) {
            if (toolCall.function?.name) {
              info.toolsUsed.push(toolCall.function.name);
            }
          }
        }
        
        // Check for errors in tool responses
        if (message.role === 'tool' && message.content) {
          try {
            const toolResult = JSON.parse(message.content);
            if (toolResult.error || toolResult.success === false) {
              info.errorCount++;
            }
          } catch {
            // Not JSON, check for error keywords
            if (message.content.toLowerCase().includes('error') || 
                message.content.toLowerCase().includes('failed')) {
              info.errorCount++;
            }
          }
        }
      }
    }

    // Check for handoff information (ConfigurableAgentTool handoff format)
    if (output.handoff) {
      info.handoffOccurred = true;
      info.handoffTarget = output.handoff.agent;
    } else if (output.handoffs && Array.isArray(output.handoffs) && output.handoffs.length > 0) {
      info.handoffOccurred = true;
      info.handoffTarget = output.handoffs[0].agent;
    }

    // Extract final status
    if (output.status) {
      info.finalStatus = output.status;
    } else if (output.success !== undefined) {
      info.finalStatus = output.success ? 'success' : 'failed';
    } else if (info.handoffOccurred) {
      info.finalStatus = 'handoff';
    }

    // Extract research sources if available (for research-type agents)
    if (output.sources && Array.isArray(output.sources)) {
      info.researchSources = output.sources;
    } else if (output.data && output.data.sources) {
      info.researchSources = output.data.sources;
    }

    // Remove duplicate tools
    info.toolsUsed = [...new Set(info.toolsUsed)];

    return info;
  }

  /**
   * Print detailed agent test result
   */
  private printAgentTestResult(result: TestResult): void {
    console.log('\n' + '='.repeat(80));
    console.log(`Agent Test: ${result.testId}`);
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
        console.log(`Agent Quality Score: ${judge.score}/100`);
        console.log(`Explanation: ${judge.explanation}`);
        
        if (judge.issues && judge.issues.length > 0) {
          console.log(`Issues: ${judge.issues.join(', ')}`);
        }
      }
    }
    
    // Show agent-specific information
    if (result.output && result.status === 'passed') {
      const conversationInfo = this.extractConversationInfo(result.output);
      console.log('\nAgent Analysis:');
      console.log(`  Conversation steps: ${conversationInfo.stepCount}`);
      console.log(`  Agent iterations: ${conversationInfo.iterations}`);
      console.log(`  Tools used: ${conversationInfo.toolsUsed.join(', ') || 'None detected'}`);
      console.log(`  Handoff occurred: ${conversationInfo.handoffOccurred ? 'Yes' : 'No'}`);
      if (conversationInfo.handoffTarget) {
        console.log(`  Handoff target: ${conversationInfo.handoffTarget}`);
      }
      console.log(`  Error count: ${conversationInfo.errorCount}`);
      console.log(`  Final status: ${conversationInfo.finalStatus}`);
      if (conversationInfo.researchSources && conversationInfo.researchSources.length > 0) {
        console.log(`  Sources found: ${conversationInfo.researchSources.length}`);
      }
      
      // Show brief output preview
      console.log('\nOutput Preview:');
      const preview = JSON.stringify(result.output, null, 2);
      console.log(preview.length > 1000 ? preview.substring(0, 1000) + '...' : preview);
    }
    
    console.log('='.repeat(80));
  }

  /**
   * Print summary of agent test results
   */
  private printAgentSummary(results: TestResult[]): void {
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const errors = results.filter(r => r.status === 'error').length;
    
    const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
    
    // Calculate agent-specific metrics
    const withValidation = results.filter(r => r.validation?.llmJudge);
    const avgScore = withValidation.length > 0 ? 
      withValidation.reduce((sum, r) => sum + (r.validation?.llmJudge?.score || 0), 0) / withValidation.length : 0;

    // Analyze conversation patterns
    const conversationStats = results
      .filter(r => r.output && r.status === 'passed')
      .map(r => this.extractConversationInfo(r.output));
    
    const avgIterations = conversationStats.length > 0 ?
      conversationStats.reduce((sum, info) => sum + info.iterations, 0) / conversationStats.length : 0;
    
    const handoffRate = conversationStats.length > 0 ?
      (conversationStats.filter(info => info.handoffOccurred).length / conversationStats.length) * 100 : 0;

    console.log('\n' + '='.repeat(80));
    console.log('AGENT EVALUATION SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total Tests: ${results.length}`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Errors: ${errors}`);
    console.log(`Success Rate: ${Math.round((passed / results.length) * 100)}%`);
    console.log(`Average Duration: ${Math.round(avgDuration)}ms`);
    
    if (withValidation.length > 0) {
      console.log(`Average Quality Score: ${Math.round(avgScore)}/100`);
    }
    
    console.log('\nAgent Behavior Analysis:');
    console.log(`Average Iterations: ${Math.round(avgIterations * 10) / 10}`);
    console.log(`Handoff Rate: ${Math.round(handoffRate)}%`);
    
    // Show most used tools
    const allToolsUsed = conversationStats.flatMap(info => info.toolsUsed);
    const toolCounts = new Map<string, number>();
    allToolsUsed.forEach(tool => {
      toolCounts.set(tool, (toolCounts.get(tool) || 0) + 1);
    });
    
    if (toolCounts.size > 0) {
      console.log('\nMost Used Tools:');
      const sortedTools = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]);
      sortedTools.slice(0, 5).forEach(([tool, count]) => {
        console.log(`  ${tool}: ${count} times`);
      });
    }
    
    console.log('='.repeat(80));
  }

  /**
   * Quick test method for development
   */
  static async quickTest<T = any>(testCase: TestCase<T>, agentName?: string): Promise<void> {
    try {
      const runner = new AgentEvaluationRunner();
      await runner.runSingleTest(testCase, agentName);
    } catch (error) {
      console.error('[AgentEvaluationRunner] Quick test failed:', error);
    }
  }
}

// Export for easy access in DevTools console
(globalThis as any).AgentEvaluationRunner = AgentEvaluationRunner;