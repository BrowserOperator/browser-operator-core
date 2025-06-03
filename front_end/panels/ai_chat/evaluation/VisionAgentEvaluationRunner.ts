// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { GenericToolEvaluator } from './framework/GenericToolEvaluator.js';
import { LLMEvaluator } from './framework/LLMEvaluator.js';
import { VisionLLMEvaluator, type ScreenshotData } from './framework/VisionLLMEvaluator.js';
import { AgentService } from '../core/AgentService.js';
import { ToolRegistry } from '../agent_framework/ConfigurableAgentTool.js';
import { TakeScreenshotTool } from '../tools/Tools.js';
import type { EvaluationConfig, TestResult, TestCase, ValidationConfig } from './framework/types.js';

/**
 * Enhanced test case interface for vision-enabled tests
 */
export interface VisionTestCase extends TestCase {
  validation: {
    type: 'llm-judge';
    llmJudge: {
      criteria: string[];
      visualVerification?: {
        enabled: boolean;
        captureBeforeAction?: boolean;
        captureAfterAction?: boolean;
        screenshotDelay?: number; // Delay after action before taking screenshot
        verificationPrompts?: string[];
      };
    };
  };
}

/**
 * Unified agent evaluation runner that supports both standard and vision-based evaluation
 * This replaces AgentEvaluationRunner when vision capabilities are needed
 */
export class VisionAgentEvaluationRunner {
  
  private evaluator: GenericToolEvaluator;
  private llmEvaluator: LLMEvaluator;
  private screenshotTool: TakeScreenshotTool;
  private config: EvaluationConfig;
  private globalVisionEnabled: boolean;

  constructor(visionEnabled: boolean = false) {
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
    this.screenshotTool = new TakeScreenshotTool();
    this.globalVisionEnabled = visionEnabled;
  }

  /**
   * Run a single test with unified evaluation approach
   */
  async runSingleTest<T = any>(testCase: TestCase<T>, agentName?: string): Promise<TestResult> {
    const toolName = agentName || testCase.tool;
    
    // Determine if we should use vision for this test
    const shouldUseVision = this.shouldUseVision(testCase);
    
    console.log(`[VisionAgentEvaluationRunner] Running test: ${testCase.name}`);
    console.log(`[VisionAgentEvaluationRunner] Agent: ${toolName}`);
    console.log(`[VisionAgentEvaluationRunner] Vision mode: ${shouldUseVision ? 'ENABLED' : 'DISABLED'}`);

    // Get the agent from ToolRegistry
    const agent = ToolRegistry.getRegisteredTool(toolName);
    if (!agent) {
      throw new Error(`Agent "${toolName}" not found in ToolRegistry. Ensure it is properly registered.`);
    }

    const startTime = Date.now();
    let beforeScreenshot: ScreenshotData | undefined;
    let afterScreenshot: ScreenshotData | undefined;
    
    try {
      // Capture before screenshot if vision is enabled
      if (shouldUseVision) {
        const visualConfig = testCase.validation.llmJudge?.visualVerification;
        
        if (visualConfig?.captureBeforeAction) {
          console.log('📸 Capturing before screenshot...');
          const beforeResult = await this.screenshotTool.execute({ fullPage: false });
          if ('dataUrl' in beforeResult) {
            beforeScreenshot = {
              dataUrl: beforeResult.dataUrl || '',
              timestamp: Date.now()
            };
            console.log('✅ Before screenshot captured');
          } else if ('error' in beforeResult) {
            console.warn('⚠️ Failed to capture before screenshot:', beforeResult.error);
          }
        }
      }

      // Execute the agent action
      const agentResult = await this.evaluator.runTest(testCase, agent as any);
      
      // Handle vision-specific post-action steps
      if (shouldUseVision && agentResult.status === 'passed') {
        const visualConfig = testCase.validation.llmJudge?.visualVerification;
        
        // Wait for dynamic content to settle
        const delay = visualConfig?.screenshotDelay || 2000;
        console.log(`⏱️ Waiting ${delay}ms for content to settle...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Capture after screenshot
        if (visualConfig?.captureAfterAction) {
          console.log('📸 Capturing after screenshot...');
          const afterResult = await this.screenshotTool.execute({ fullPage: false });
          if ('dataUrl' in afterResult) {
            afterScreenshot = {
              dataUrl: afterResult.dataUrl || '',
              timestamp: Date.now()
            };
            console.log('✅ After screenshot captured');
          } else if ('error' in afterResult) {
            console.warn('⚠️ Failed to capture after screenshot:', afterResult.error);
          }
        }
      }

      // Perform evaluation based on vision mode
      if (agentResult.status === 'passed' && agentResult.output && testCase.validation.type === 'llm-judge') {
        let llmJudgment;
        
        if (shouldUseVision && (beforeScreenshot || afterScreenshot)) {
          console.log('🤖 Running vision-enabled evaluation...');
          // Use vision evaluation
          llmJudgment = await VisionLLMEvaluator.evaluateWithScreenshots(
            agentResult.output,
            testCase,
            { before: beforeScreenshot, after: afterScreenshot }
          );
        } else {
          console.log('📝 Running standard LLM evaluation...');
          // Use standard LLM evaluation
          llmJudgment = await this.evaluateAgentResult(
            agentResult.output,
            testCase,
            testCase.validation
          );
        }
        
        // Update result with evaluation
        if (agentResult.validation) {
          agentResult.validation.llmJudge = llmJudgment;
          agentResult.validation.passed = agentResult.validation.passed && llmJudgment.passed;
          agentResult.validation.summary += ` | ${shouldUseVision ? 'Vision' : 'LLM'} Score: ${llmJudgment.score}/100`;
        }
      }

      // Add screenshot data to output if available
      if (beforeScreenshot || afterScreenshot) {
        agentResult.output = {
          ...agentResult.output,
          screenshots: { before: beforeScreenshot, after: afterScreenshot }
        };
      }

      return agentResult;

    } catch (error) {
      console.error(`❌ Test failed with error:`, error);
      return {
        testId: testCase.id,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        output: {
          screenshots: { before: beforeScreenshot, after: afterScreenshot }
        },
        duration: Date.now() - startTime,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Determine if vision should be used for a test
   */
  private shouldUseVision(testCase: TestCase): boolean {
    // Check if test has vision verification enabled
    const testVisionEnabled = testCase.validation.type === 'llm-judge' && 
                              testCase.validation.llmJudge?.visualVerification?.enabled === true;
    
    // Use vision if both global flag and test-specific flag are enabled
    return this.globalVisionEnabled && testVisionEnabled;
  }

  /**
   * Standard LLM evaluation for agent results (non-vision)
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

    // Add handoff criteria if handoff occurred
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
  private extractConversationInfo(output: any): any {
    const info = {
      toolsUsed: [] as string[],
      stepCount: 0,
      handoffOccurred: false,
      handoffTarget: undefined as string | undefined,
      iterations: 0,
      researchSources: [] as string[],
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

    // Check for handoff information
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

    // Extract research sources if available
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
   * Check if a test case has vision capabilities enabled
   */
  static isVisionEnabled(testCase: TestCase): testCase is VisionTestCase {
    return testCase.validation.type === 'llm-judge' && 
           testCase.validation.llmJudge?.visualVerification?.enabled === true;
  }

  /**
   * Set global vision enabled flag
   */
  setVisionEnabled(enabled: boolean): void {
    this.globalVisionEnabled = enabled;
    console.log(`Global vision mode: ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }
}