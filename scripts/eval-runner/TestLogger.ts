/**
 * TestLogger - Detailed per-test logging for debugging failed tests
 *
 * Creates a structured log directory for each test run with:
 * - Per-test directories containing all execution data
 * - LLM call logs (prompts, responses, tokens)
 * - Tool call logs (parameters, results)
 * - DOM snapshots (before/after)
 * - Console errors from the browser
 * - Human-readable execution log
 */

import fs from 'fs';
import path from 'path';
import type { TestCase, TestResult } from './types.ts';

export interface LLMCallLog {
  timestamp: string;
  request: {
    messages: unknown[];
    config: unknown;
  };
  response: {
    content: string;
    toolCalls?: unknown[];
    usage?: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };
  };
  durationMs: number;
}

export interface ToolCallLog {
  timestamp: string;
  toolName: string;
  args: unknown;
  result: unknown;
  durationMs: number;
  error?: string;
}

export interface DOMSnapshot {
  timestamp: string;
  label: string;
  url: string;
  dom?: unknown;
  accessibility?: unknown;
  elementCount?: number;
}

export class TestLogger {
  private runDir: string;
  private testDir: string | null = null;
  private currentTestId: string | null = null;
  private llmCalls: LLMCallLog[] = [];
  private toolCalls: ToolCallLog[] = [];
  private consoleErrors: string[] = [];
  private executionLog: string[] = [];
  private failedTests: Array<{ id: string; name: string; error: string }> = [];
  private enabled: boolean;
  private screenshotCounter: number = 0;

  constructor(baseDir: string = './eval-logs', enabled: boolean = true) {
    this.enabled = enabled;

    if (!enabled) {
      this.runDir = '';
      return;
    }

    // Create timestamped run directory
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    this.runDir = path.join(baseDir, `run-${timestamp}`);
    fs.mkdirSync(this.runDir, { recursive: true });

    this.log(`Test run started: ${this.runDir}`);
  }

  /**
   * Start logging for a new test
   */
  startTest(testId: string): void {
    if (!this.enabled) return;

    this.currentTestId = testId;
    this.testDir = path.join(this.runDir, testId);
    fs.mkdirSync(this.testDir, { recursive: true });

    // Reset per-test data
    this.llmCalls = [];
    this.toolCalls = [];
    this.consoleErrors = [];
    this.executionLog = [];
    this.screenshotCounter = 0;

    this.logExecution(`Test started: ${testId}`);
  }

  /**
   * Log the test case definition
   */
  logTestInfo(testCase: TestCase): void {
    if (!this.enabled || !this.testDir) return;

    const testInfo = {
      id: testCase.id,
      name: testCase.name,
      description: testCase.description,
      url: testCase.url,
      tool: testCase.tool,
      input: testCase.input,
      validation: testCase.validation,
      metadata: testCase.metadata,
    };

    this.writeJSON('test-info.json', testInfo);
    this.logExecution(`Test: ${testCase.name}`);
    this.logExecution(`URL: ${testCase.url}`);
    this.logExecution(`Tool: ${testCase.tool}`);
    this.logExecution(`Input: ${JSON.stringify(testCase.input, null, 2)}`);
  }

  /**
   * Log an LLM call (request + response)
   */
  logLLMCall(
    request: { messages: unknown[]; config: unknown },
    response: { content: string; toolCalls?: unknown[]; usage?: unknown },
    durationMs: number
  ): void {
    if (!this.enabled) return;

    const entry: LLMCallLog = {
      timestamp: new Date().toISOString(),
      request,
      response: {
        content: response.content,
        toolCalls: response.toolCalls,
        usage: response.usage as LLMCallLog['response']['usage'],
      },
      durationMs,
    };

    this.llmCalls.push(entry);

    // Log summary to execution log
    const msgCount = request.messages.length;
    const tokens = response.usage ? JSON.stringify(response.usage) : 'unknown';
    this.logExecution(`LLM Call #${this.llmCalls.length}: ${msgCount} messages, ${durationMs}ms, tokens: ${tokens}`);

    if (response.toolCalls && Array.isArray(response.toolCalls) && response.toolCalls.length > 0) {
      this.logExecution(`  Tool calls requested: ${response.toolCalls.map((tc: any) => tc.function?.name || tc.name).join(', ')}`);
    }
  }

  /**
   * Log a tool execution
   */
  logToolCall(
    toolName: string,
    args: unknown,
    result: unknown,
    durationMs: number,
    error?: string
  ): void {
    if (!this.enabled) return;

    const entry: ToolCallLog = {
      timestamp: new Date().toISOString(),
      toolName,
      args,
      result,
      durationMs,
      error,
    };

    this.toolCalls.push(entry);

    // Log summary to execution log
    const status = error ? `ERROR: ${error}` : 'success';
    this.logExecution(`Tool: ${toolName} (${durationMs}ms) - ${status}`);
    this.logExecution(`  Args: ${JSON.stringify(args, null, 2).split('\n').join('\n  ')}`);

    // Truncate result for log readability
    const resultStr = JSON.stringify(result);
    const truncatedResult = resultStr.length > 500 ? resultStr.slice(0, 500) + '...' : resultStr;
    this.logExecution(`  Result: ${truncatedResult}`);
  }

  /**
   * Log a DOM snapshot
   */
  logDOMSnapshot(label: string, url: string, snapshot: { dom?: unknown; accessibility?: unknown }): void {
    if (!this.enabled || !this.testDir) return;

    const data: DOMSnapshot = {
      timestamp: new Date().toISOString(),
      label,
      url,
      dom: snapshot.dom,
      accessibility: snapshot.accessibility,
      elementCount: this.countElements(snapshot.accessibility),
    };

    this.writeJSON(`dom-snapshot-${label}.json`, data);
    this.logExecution(`DOM Snapshot (${label}): ${data.elementCount} elements`);
  }

  /**
   * Log console errors from the browser
   */
  logConsoleError(error: string): void {
    if (!this.enabled) return;

    this.consoleErrors.push(`[${new Date().toISOString()}] ${error}`);
    this.logExecution(`Console Error: ${error}`);
  }

  /**
   * Log multiple console errors at once
   */
  logConsoleErrors(errors: string[]): void {
    errors.forEach(e => this.logConsoleError(e));
  }

  /**
   * Add a message to the human-readable execution log
   */
  logExecution(message: string): void {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString().slice(11, 23);
    this.executionLog.push(`[${timestamp}] ${message}`);
  }

  /**
   * Log a screenshot path
   */
  logScreenshot(label: string, filepath: string): void {
    if (!this.enabled || !this.testDir) return;

    // Copy screenshot to test directory
    const filename = `screenshot-${label}.png`;
    const destPath = path.join(this.testDir, filename);

    try {
      fs.copyFileSync(filepath, destPath);
      this.logExecution(`Screenshot (${label}): ${filename}`);
    } catch (error) {
      this.logExecution(`Failed to copy screenshot: ${error}`);
    }
  }

  /**
   * End logging for current test and write all files
   */
  endTest(result: TestResult): void {
    if (!this.enabled || !this.testDir) return;

    this.logExecution(`Test ended: ${result.status.toUpperCase()} (score: ${(result.score * 100).toFixed(1)}%)`);

    if (result.error) {
      this.logExecution(`Error: ${result.error}`);
    }

    if (result.validation?.explanation) {
      this.logExecution(`Validation: ${result.validation.explanation}`);
    }

    // Write all accumulated logs
    this.writeJSON('result.json', {
      testId: result.testId,
      testName: result.testName,
      status: result.status,
      score: result.score,
      duration: result.duration,
      error: result.error,
      validation: result.validation,
      metadata: result.metadata,
    });

    if (this.llmCalls.length > 0) {
      this.writeJSON('llm-calls.json', this.llmCalls);
    }

    if (this.toolCalls.length > 0) {
      this.writeJSON('tool-calls.json', this.toolCalls);
    }

    if (this.consoleErrors.length > 0) {
      this.writeJSON('console-errors.json', this.consoleErrors);
    }

    // Write human-readable execution log
    this.writeText('execution.log', this.executionLog.join('\n'));

    // Track failed tests
    if (result.status === 'failed' || result.status === 'error') {
      this.failedTests.push({
        id: result.testId,
        name: result.testName,
        error: result.error || result.validation?.explanation || 'Unknown error',
      });
    }

    // Reset state
    this.testDir = null;
    this.currentTestId = null;
  }

  /**
   * Finalize the run and write summary files
   */
  finalize(summary: {
    total: number;
    passed: number;
    failed: number;
    errors: number;
    duration: number;
    averageScore: number;
  }): void {
    if (!this.enabled) return;

    // Write run summary
    this.writeJSONToRun('summary.json', {
      timestamp: new Date().toISOString(),
      ...summary,
      passRate: summary.total > 0 ? (summary.passed / summary.total * 100).toFixed(1) + '%' : '0%',
    });

    // Write failed tests list
    if (this.failedTests.length > 0) {
      const failedContent = this.failedTests
        .map(t => `${t.id}\n  Name: ${t.name}\n  Error: ${t.error}\n`)
        .join('\n');
      this.writeTextToRun('failed-tests.txt', failedContent);
    }

    this.log(`Test run complete. Logs saved to: ${this.runDir}`);
    if (this.failedTests.length > 0) {
      this.log(`Failed tests: ${this.failedTests.length}`);
      this.log(`See: ${path.join(this.runDir, 'failed-tests.txt')}`);
    }
  }

  /**
   * Get the run directory path
   */
  getRunDir(): string {
    return this.runDir;
  }

  /**
   * Get the current test directory path
   */
  getTestDir(): string | null {
    return this.testDir;
  }

  /**
   * Get the next screenshot number (increments counter)
   */
  getNextScreenshotNumber(): number {
    return ++this.screenshotCounter;
  }

  /**
   * Check if logging is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  // Private helper methods

  private writeJSON(filename: string, data: unknown): void {
    if (!this.testDir) return;
    const filepath = path.join(this.testDir, filename);
    try {
      fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.warn(`[TestLogger] Failed to write ${filename}: ${error}`);
    }
  }

  private writeText(filename: string, content: string): void {
    if (!this.testDir) return;
    const filepath = path.join(this.testDir, filename);
    try {
      fs.writeFileSync(filepath, content);
    } catch (error) {
      console.warn(`[TestLogger] Failed to write ${filename}: ${error}`);
    }
  }

  private writeJSONToRun(filename: string, data: unknown): void {
    const filepath = path.join(this.runDir, filename);
    try {
      fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.warn(`[TestLogger] Failed to write ${filename}: ${error}`);
    }
  }

  private writeTextToRun(filename: string, content: string): void {
    const filepath = path.join(this.runDir, filename);
    try {
      fs.writeFileSync(filepath, content);
    } catch (error) {
      console.warn(`[TestLogger] Failed to write ${filename}: ${error}`);
    }
  }

  private countElements(accessibility: unknown): number {
    if (!accessibility || !Array.isArray(accessibility)) return 0;
    return accessibility.length;
  }

  private log(message: string): void {
    console.log(`[TestLogger] ${message}`);
  }
}
