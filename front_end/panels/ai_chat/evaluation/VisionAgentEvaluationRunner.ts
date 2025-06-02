// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { AgentEvaluationRunner, type AgentConversationInfo } from './AgentEvaluationRunner.js';
import { VisionLLMEvaluator, type ScreenshotData } from './framework/VisionLLMEvaluator.js';
import { TakeScreenshotTool } from '../tools/Tools.js';
import type { TestCase, TestResult } from './framework/types.js';

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
 * Enhanced agent evaluation runner with screenshot capture and vision analysis
 */
export class VisionAgentEvaluationRunner {
  
  private screenshotTool: TakeScreenshotTool;
  private baseRunner: AgentEvaluationRunner;

  constructor() {
    this.screenshotTool = new TakeScreenshotTool();
    this.baseRunner = new AgentEvaluationRunner();
  }

  /**
   * Run a single test with optional screenshot capture and vision evaluation
   */
  async runSingleTestWithVision(
    testCase: VisionTestCase, 
    agentName: string
  ): Promise<TestResult> {
    
    console.log(`🔍 Running vision test: ${testCase.id} with agent: ${agentName}`);
    
    const startTime = Date.now();
    let beforeScreenshot: ScreenshotData | undefined;
    let afterScreenshot: ScreenshotData | undefined;
    
    try {
      // Check if visual verification is enabled
      const visualConfig = testCase.validation.llmJudge?.visualVerification;
      const useVision = visualConfig?.enabled === true;
      
      console.log(`Vision verification: ${useVision ? 'enabled' : 'disabled'}`);

      // Capture before screenshot if requested
      if (useVision && visualConfig?.captureBeforeAction) {
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

      // Execute the action using the base runner
      const agentResult = await this.baseRunner.runSingleTest(testCase, agentName);
      
      // Wait for any dynamic content to settle
      if (useVision && visualConfig?.screenshotDelay) {
        console.log(`⏱️ Waiting ${visualConfig.screenshotDelay}ms for content to settle...`);
        await new Promise(resolve => setTimeout(resolve, visualConfig.screenshotDelay));
      } else if (useVision) {
        // Default delay for dynamic content
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Capture after screenshot if requested
      if (useVision && visualConfig?.captureAfterAction) {
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

      // If vision is enabled and we have screenshots, use vision evaluation
      if (useVision && (beforeScreenshot || afterScreenshot)) {
        console.log('🤖 Running vision-enabled evaluation...');
        
        // Use vision-enabled evaluation
        const llmJudgeResult = await VisionLLMEvaluator.evaluateWithScreenshots(
          agentResult.output,
          testCase,
          { before: beforeScreenshot, after: afterScreenshot }
        );
        
        // Update the result with vision evaluation
        return {
          ...agentResult,
          validation: {
            passed: llmJudgeResult.passed,
            llmJudge: llmJudgeResult,
            summary: `Vision evaluation: ${llmJudgeResult.passed ? 'PASSED' : 'FAILED'} (Score: ${llmJudgeResult.score}/100)`
          },
          output: {
            ...agentResult.output,
            screenshots: { before: beforeScreenshot, after: afterScreenshot }
          }
        };
      } else {
        console.log('📝 Using standard evaluation...');
        // Return the standard result with screenshot data if available
        return {
          ...agentResult,
          output: {
            ...agentResult.output,
            screenshots: useVision ? { before: beforeScreenshot, after: afterScreenshot } : undefined
          }
        };
      }

    } catch (error) {
      console.error(`❌ Vision test failed with error:`, error);
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
   * Check if a test case has vision capabilities enabled
   */
  static isVisionEnabled(testCase: TestCase): testCase is VisionTestCase {
    return testCase.validation.type === 'llm-judge' && 
           testCase.validation.llmJudge?.visualVerification?.enabled === true;
  }
}