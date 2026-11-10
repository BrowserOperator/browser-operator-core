/**
 * Test Runner - Orchestrates test execution and evaluation
 *
 * Coordinates between BrowserExecutor, AgentBridge, LLM Judge,
 * and BraintrustTracker to run evaluations.
 */

import { getStatusIcon, type TestCase, type TestResult, type RunSummary, type CLIOptions, type CriteriaResult } from './types.ts';
import { BrowserExecutor, type ExecutionContext } from './BrowserExecutor.ts';
import { BraintrustTracker } from './BraintrustTracker.ts';
import { AgentBridge } from './AgentBridge.ts';
import { LLMJudge } from './LLMJudge.ts';
import { TestLogger } from './TestLogger.ts';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to fixture files
const FIXTURES_DIR = path.resolve(__dirname, '../../front_end/panels/ai_chat/testing/fixtures');

export class TestRunner {
  private options: CLIOptions;
  private browserExecutor: BrowserExecutor;
  private braintrustTracker: BraintrustTracker;
  private agentBridge: AgentBridge;
  private llmJudge: LLMJudge;
  private testLogger: TestLogger;
  private results: TestResult[] = [];

  constructor(options: CLIOptions) {
    this.options = options;
    this.browserExecutor = new BrowserExecutor({
      chromePath: options.chromePath,
      headless: options.headless,
      timeout: options.timeout,
      screenshotDir: options.screenshotDir,
      remoteDebuggingPort: options.remoteDebuggingPort,
    });
    this.braintrustTracker = new BraintrustTracker();
    this.agentBridge = new AgentBridge(options);
    this.llmJudge = new LLMJudge({
      provider: options.judgeProvider,
      model: options.judgeModel,
      apiKey: options.judgeApiKey,
    });
    this.testLogger = new TestLogger(options.logDir, options.detailedLogs);
  }

  /**
   * Initialize the runner
   */
  async init(): Promise<void> {
    console.log('\n🚀 Initializing Evaluation Runner...\n');

    // Initialize Braintrust if configured
    if (this.options.experiment && this.options.braintrustApiKey) {
      await this.braintrustTracker.init({
        apiKey: this.options.braintrustApiKey,
        org: this.options.org || 'BO',
        project: this.options.project || 'browser-operator',
        experiment: this.options.experiment,
        metadata: {
          model: this.options.model,
          judgeModel: this.options.judgeModel,
          provider: this.options.provider,
        },
      });
    }

    // Initialize browser
    await this.browserExecutor.launch();

    // Initialize AgentBridge (registers tools and agents)
    await this.agentBridge.init();

    // Initialize LLM Judge (optional - will warn if no API key)
    try {
      await this.llmJudge.init();
    } catch (error) {
      console.warn(`⚠️  LLM Judge not available: ${error}`);
      console.warn('   DOM tests will still run with assertion-based evaluation.\n');
    }

    console.log('✅ Initialization complete\n');
  }

  /**
   * Run a batch of tests
   */
  async runTests(testCases: TestCase[]): Promise<RunSummary> {
    const startTime = new Date();
    console.log(`📋 Running ${testCases.length} tests...\n`);

    if (this.options.parallel && this.options.concurrency > 1) {
      await this.runParallel(testCases);
    } else {
      await this.runSequential(testCases);
    }

    const endTime = new Date();
    const duration = endTime.getTime() - startTime.getTime();

    const summary = this.createSummary(startTime, endTime, duration);

    // Finalize Braintrust tracking
    await this.braintrustTracker.finalize(summary);

    // Finalize test logging
    this.testLogger.finalize({
      total: summary.total,
      passed: summary.passed,
      failed: summary.failed,
      errors: summary.errors,
      duration: summary.duration,
      averageScore: summary.averageScore,
    });

    return summary;
  }

  /**
   * Run tests sequentially
   */
  private async runSequential(testCases: TestCase[]): Promise<void> {
    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      console.log(`[${i + 1}/${testCases.length}] ${testCase.name}`);

      const result = await this.runSingleTest(testCase);
      this.results.push(result);

      // Log to Braintrust
      await this.braintrustTracker.logResult(testCase, result);

      this.printTestResult(result);
    }
  }

  /**
   * Run tests in parallel with concurrency limit
   */
  private async runParallel(testCases: TestCase[]): Promise<void> {
    const concurrency = this.options.concurrency;
    const queue = [...testCases];
    const running: Promise<void>[] = [];

    let completed = 0;

    const runNext = async (): Promise<void> => {
      if (queue.length === 0) return;

      const testCase = queue.shift()!;
      completed++;
      console.log(`[${completed}/${testCases.length}] ${testCase.name}`);

      const result = await this.runSingleTest(testCase);
      this.results.push(result);
      await this.braintrustTracker.logResult(testCase, result);
      this.printTestResult(result);

      // Start next test
      await runNext();
    };

    // Start initial batch
    for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
      running.push(runNext());
    }

    await Promise.all(running);
  }

  /**
   * Resolve a test URL - handles fixture:// URLs
   */
  private resolveTestUrl(url: string): string {
    if (url.startsWith('fixture://')) {
      const fixtureName = url.slice('fixture://'.length);
      const fixturePath = path.join(FIXTURES_DIR, fixtureName);
      return `file://${fixturePath}`;
    }
    return url;
  }

  /**
   * Run a single test case
   */
  async runSingleTest(testCase: TestCase): Promise<TestResult> {
    const startTime = Date.now();
    let context: ExecutionContext | null = null;
    let retryCount = 0;

    // Resolve fixture:// URLs to file:// paths
    const testUrl = this.resolveTestUrl(testCase.url);

    // Start test logging
    this.testLogger.startTest(testCase.id);
    this.testLogger.logTestInfo(testCase);

    while (retryCount <= (testCase.metadata.retries || this.options.retries)) {
      try {
        // Create browser context
        context = await this.browserExecutor.createContext();
        this.testLogger.logExecution('Browser context created');

        // Navigate to test URL (resolved)
        await this.browserExecutor.navigateTo(context.page, testUrl, {
          waitForSelector: testCase.metadata.waitForSelector,
          waitAfterNavigation: testCase.metadata.waitAfterNavigation,
        });
        this.testLogger.logExecution(`Navigated to: ${testUrl}`);

        // Capture DOM snapshot before action
        try {
          const beforeSnapshot = await this.browserExecutor.getDOMSnapshot(context.cdp, context.page);
          this.testLogger.logDOMSnapshot('before', beforeSnapshot.url, beforeSnapshot);
        } catch (snapshotError) {
          this.testLogger.logExecution(`Failed to capture before DOM snapshot: ${snapshotError}`);
        }

        // Take before screenshot if enabled
        let beforeScreenshot: string | undefined;
        if (this.options.screenshots && testCase.validation.llmJudge?.visualVerification?.captureBeforeAction) {
          beforeScreenshot = await this.browserExecutor.takeScreenshot(
            context.page,
            testCase.id,
            'before'
          );
          this.testLogger.logScreenshot('before', beforeScreenshot);
        }

        // Execute the agent/tool
        this.testLogger.logExecution('Starting agent execution...');
        const agentResult = await this.agentBridge.execute(testCase, context, this.testLogger);
        this.testLogger.logExecution('Agent execution completed');

        // Capture DOM snapshot after action
        try {
          const afterSnapshot = await this.browserExecutor.getDOMSnapshot(context.cdp, context.page);
          this.testLogger.logDOMSnapshot('after', afterSnapshot.url, afterSnapshot);
        } catch (snapshotError) {
          this.testLogger.logExecution(`Failed to capture after DOM snapshot: ${snapshotError}`);
        }

        // Log any console errors that occurred
        if (context.consoleErrors.length > 0) {
          this.testLogger.logConsoleErrors(context.consoleErrors);
        }

        // Take after screenshot if enabled
        let afterScreenshot: string | undefined;
        if (this.options.screenshots && testCase.validation.llmJudge?.visualVerification?.captureAfterAction) {
          afterScreenshot = await this.browserExecutor.takeScreenshot(
            context.page,
            testCase.id,
            'after'
          );
          this.testLogger.logScreenshot('after', afterScreenshot);
        }

        // Evaluate with LLM Judge
        this.testLogger.logExecution('Starting evaluation...');
        const validation = await this.evaluateResult(testCase, agentResult, {
          beforeScreenshot,
          afterScreenshot,
        });
        this.testLogger.logExecution(`Evaluation complete: ${validation.passed ? 'PASSED' : 'FAILED'} (score: ${(validation.score * 100).toFixed(1)}%)`);

        const duration = Date.now() - startTime;

        const result: TestResult = {
          testId: testCase.id,
          testName: testCase.name,
          status: validation.passed ? 'passed' : 'failed',
          score: validation.score,
          duration,
          output: agentResult,
          validation,
          screenshots: {
            before: beforeScreenshot,
            after: afterScreenshot,
          },
          metadata: {
            retryCount,
            url: testCase.url,
          },
          metrics: agentResult.metrics,
        };

        // End test logging
        this.testLogger.endTest(result);

        return result;
      } catch (error) {
        retryCount++;
        this.testLogger.logExecution(`Error during execution: ${error}`);

        if (retryCount > (testCase.metadata.retries || this.options.retries)) {
          const duration = Date.now() - startTime;
          const result: TestResult = {
            testId: testCase.id,
            testName: testCase.name,
            status: 'error',
            score: 0,
            duration,
            error: String(error),
            metadata: {
              retryCount,
              url: testCase.url,
            },
          };

          // End test logging with error
          this.testLogger.endTest(result);

          return result;
        }
        this.testLogger.logExecution(`Retry ${retryCount}/${testCase.metadata.retries || this.options.retries}...`);
        console.log(`   ⚠️ Retry ${retryCount}/${testCase.metadata.retries || this.options.retries}...`);
      } finally {
        if (context) {
          await this.browserExecutor.closeContext(context);
        }
      }
    }

    // Should not reach here
    const result: TestResult = {
      testId: testCase.id,
      testName: testCase.name,
      status: 'error',
      score: 0,
      duration: Date.now() - startTime,
      error: 'Unexpected error in test execution',
    };

    this.testLogger.endTest(result);
    return result;
  }

  /**
   * Deterministic evaluation for search tool results
   */
  private evaluateSearchDeterministically(
    testCase: TestCase,
    agentResult: unknown
  ): { passed: boolean; score: number; explanation: string; criteria: CriteriaResult[] } {
    const criteria: CriteriaResult[] = [];
    // The search tool result is in agentResult.output (from mapAgentResult)
    const agent = agentResult as { output?: { results?: Array<{ title?: string; url?: string; snippet?: string; position?: number }> } };
    const results = agent?.output?.results || [];
    const minResults = (testCase.input as any)?.maxResults || 3;

    // Check 1: Got results
    criteria.push({
      criterion: 'Extracted search results',
      passed: results.length >= minResults,
      explanation: `Got ${results.length} results (need ${minResults})`,
    });

    // Check 2: Each has title and URL (empty arrays should fail)
    const hasFields = results.length > 0 && results.every(r => (r.title?.length || 0) > 0 && (r.url?.length || 0) > 0);
    criteria.push({
      criterion: 'Each result has title and URL',
      passed: hasFields,
      explanation: hasFields ? 'All results have title and URL' : 'Some results missing title or URL',
    });

    // Check 3: URLs are valid (empty arrays should fail)
    const validUrls = results.length > 0 && results.every(r => {
      try { new URL(r.url || ''); return true; } catch { return false; }
    });
    criteria.push({
      criterion: 'URLs are valid',
      passed: validUrls,
      explanation: validUrls ? 'All URLs are valid' : 'Some URLs are invalid',
    });

    // Check 4: Has snippets (empty arrays should fail)
    const hasSnippets = results.length > 0 && results.every(r => (r.snippet?.length || 0) > 20);
    criteria.push({
      criterion: 'Results have snippets',
      passed: hasSnippets,
      explanation: hasSnippets ? 'All results have snippets' : 'Some results missing snippets',
    });

    // Check 5: Ordered by position (empty arrays should fail)
    const ordered = results.length > 0 && results.every((r, i) => r.position === i + 1);
    criteria.push({
      criterion: 'Results are ordered',
      passed: ordered,
      explanation: ordered ? 'Results correctly ordered' : 'Results not in order',
    });

    const passedCount = criteria.filter(c => c.passed).length;
    const score = passedCount / criteria.length;

    return {
      passed: score === 1.0,
      score,
      explanation: `${passedCount}/${criteria.length} criteria passed`,
      criteria,
    };
  }

  /**
   * Evaluate test result with LLM Judge or assertion-based evaluation
   */
  private async evaluateResult(
    testCase: TestCase,
    agentResult: unknown,
    screenshots: { beforeScreenshot?: string; afterScreenshot?: string }
  ): Promise<{
    passed: boolean;
    score: number;
    explanation: string;
    criteria: CriteriaResult[];
  }> {
    // For search tool tests, use deterministic evaluation
    if (testCase.tool === 'search') {
      return this.evaluateSearchDeterministically(testCase, agentResult);
    }

    // For DOM tests, use assertion-based evaluation
    if (testCase.tool === 'dom_test' && agentResult && typeof agentResult === 'object') {
      const result = agentResult as { success?: boolean; output?: { assertions?: any[] }; error?: string };
      const assertions = result.output?.assertions || [];

      const criteria: CriteriaResult[] = assertions.map((a: any) => ({
        criterion: a.description,
        passed: a.passed,
        explanation: a.error || (a.data ? JSON.stringify(a.data) : ''),
      }));

      const passedCount = criteria.filter(c => c.passed).length;
      const score = criteria.length > 0 ? passedCount / criteria.length : (result.success ? 1 : 0);

      return {
        passed: result.success ?? false,
        score,
        explanation: result.error || `${passedCount}/${criteria.length} assertions passed`,
        criteria,
      };
    }

    // Default evaluation for non-LLM judge or when LLM is not available
    if (testCase.validation.type !== 'llm-judge' || !testCase.validation.llmJudge) {
      const hasError = agentResult && typeof agentResult === 'object' && 'error' in agentResult;
      return {
        passed: !hasError,
        score: hasError ? 0 : 1,
        explanation: hasError ? 'Agent returned error' : 'Agent completed successfully',
        criteria: [],
      };
    }

    // Use LLM judge for evaluation
    return await this.llmJudge.evaluate(testCase, agentResult, screenshots);
  }

  /**
   * Print result for a single test
   */
  private printTestResult(result: TestResult): void {
    const icon = getStatusIcon(result.status);
    const score = result.score !== undefined ? ` (${(result.score * 100).toFixed(0)}%)` : '';
    const duration = `${(result.duration / 1000).toFixed(1)}s`;

    console.log(`   ${icon} ${result.status.toUpperCase()}${score} - ${duration}`);

    if (this.options.verbose) {
      if (result.validation?.explanation) {
        console.log(`      💬 ${result.validation.explanation}`);
      }
      if (result.error) {
        console.log(`      ⚠️ ${result.error}`);
      }
    }
    console.log('');
  }

  /**
   * Create run summary
   */
  private createSummary(startTime: Date, endTime: Date, duration: number): RunSummary {
    const passed = this.results.filter(r => r.status === 'passed').length;
    const failed = this.results.filter(r => r.status === 'failed').length;
    const errors = this.results.filter(r => r.status === 'error').length;
    const skipped = this.results.filter(r => r.status === 'skipped').length;

    const scores = this.results.map(r => r.score).filter(s => s !== undefined);
    const averageScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const averageDuration = this.results.length > 0
      ? this.results.reduce((a, r) => a + r.duration, 0) / this.results.length
      : 0;

    return {
      experiment: this.options.experiment,
      startTime,
      endTime,
      duration,
      total: this.results.length,
      passed,
      failed,
      errors,
      skipped,
      averageScore,
      averageDuration,
      results: this.results,
    };
  }

  /**
   * Get the Braintrust experiment URL
   */
  getExperimentUrl(): string | null {
    return this.braintrustTracker.getExperimentUrl();
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    await this.browserExecutor.close();
  }

  /**
   * Get the test log directory for this run
   */
  getLogDir(): string {
    return this.testLogger.getRunDir();
  }
}
