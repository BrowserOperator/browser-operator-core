/**
 * Braintrust SDK Integration for Experiment Tracking
 *
 * Provides seamless integration with Braintrust for tracking
 * evaluation experiments, logging results, and computing scores.
 */

import type { TestCase, TestResult, RunSummary, BraintrustConfig } from './types.ts';

// Braintrust types (will be available after npm install)
interface BraintrustExperiment {
  log: (data: LogData) => void;
  summarize: () => Promise<ExperimentSummary>;
  close: () => Promise<void>;
}

interface LogData {
  input: unknown;
  output: unknown;
  expected?: unknown;
  scores?: Record<string, number>;
  metadata?: Record<string, unknown>;
  id?: string;
}

interface ExperimentSummary {
  experimentName: string;
  scores: Record<string, { mean: number; std: number }>;
  metrics: Record<string, number>;
}

/**
 * BraintrustTracker handles experiment lifecycle and result logging
 */
export class BraintrustTracker {
  private config: BraintrustConfig | null = null;
  private experiment: BraintrustExperiment | null = null;
  private braintrust: any = null;
  private enabled: boolean = false;

  /**
   * Initialize Braintrust tracking
   */
  async init(config: BraintrustConfig): Promise<boolean> {
    this.config = config;

    try {
      // Dynamically import braintrust to handle case where it's not installed
      const braintrustModule = await import('braintrust');
      this.braintrust = braintrustModule;

      // Initialize experiment
      this.experiment = await braintrustModule.init({
        project: config.project,
        experiment: config.experiment,
        apiKey: config.apiKey,
        metadata: {
          ...config.metadata,
          runner: 'cli-eval-runner',
          timestamp: new Date().toISOString(),
        },
      });

      this.enabled = true;
      console.log(`📊 Braintrust experiment initialized: ${config.project}/${config.experiment}`);
      return true;
    } catch (error) {
      if ((error as any).code === 'ERR_MODULE_NOT_FOUND') {
        console.warn('⚠️  Braintrust SDK not installed. Run: npm install braintrust');
        console.warn('   Continuing without experiment tracking...');
      } else {
        console.warn(`⚠️  Failed to initialize Braintrust: ${error}`);
      }
      this.enabled = false;
      return false;
    }
  }

  /**
   * Check if tracking is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Log a single test result to Braintrust
   */
  async logResult(testCase: TestCase, result: TestResult): Promise<void> {
    if (!this.enabled || !this.experiment) return;

    try {
      const scores: Record<string, number> = {
        success: result.status === 'passed' ? 1 : 0,
        score: result.score,
      };

      // Add individual criteria scores if available
      if (result.validation?.criteria) {
        result.validation.criteria.forEach((c, i) => {
          scores[`criterion_${i + 1}`] = c.passed ? 1 : 0;
        });
      }

      this.experiment.log({
        id: testCase.id,
        input: {
          url: testCase.url,
          tool: testCase.tool,
          ...testCase.input,
        },
        output: {
          status: result.status,
          output: result.output,
          error: result.error,
          validation: result.validation,
        },
        expected: {
          status: 'passed',
          criteria: testCase.validation.llmJudge?.criteria || [],
        },
        scores,
        metadata: {
          testName: testCase.name,
          description: testCase.description,
          tags: testCase.metadata.tags,
          duration: result.duration,
          screenshots: result.screenshots,
        },
      });
    } catch (error) {
      console.warn(`⚠️  Failed to log result to Braintrust: ${error}`);
    }
  }

  /**
   * Create a traced span for a test execution
   */
  async traced<T>(
    name: string,
    fn: (span: any) => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    if (!this.enabled || !this.braintrust) {
      return fn({
        log: () => {},
        setOutput: () => {},
      });
    }

    try {
      return await this.braintrust.traced(fn, {
        name,
        ...metadata,
      });
    } catch (error) {
      console.warn(`⚠️  Tracing failed: ${error}`);
      return fn({ log: () => {}, setOutput: () => {} });
    }
  }

  /**
   * Finalize the experiment and get summary
   */
  async finalize(summary: RunSummary): Promise<ExperimentSummary | null> {
    if (!this.enabled || !this.experiment) return null;

    try {
      // Log final summary
      this.experiment.log({
        id: '_summary',
        input: { type: 'run_summary' },
        output: {
          total: summary.total,
          passed: summary.passed,
          failed: summary.failed,
          errors: summary.errors,
          duration: summary.duration,
        },
        scores: {
          pass_rate: summary.total > 0 ? summary.passed / summary.total : 0,
          average_score: summary.averageScore,
        },
        metadata: {
          startTime: summary.startTime.toISOString(),
          endTime: summary.endTime.toISOString(),
          averageDuration: summary.averageDuration,
        },
      });

      const experimentSummary = await this.experiment.summarize();
      await this.experiment.close();

      console.log(`\n📊 Braintrust Experiment Summary:`);
      console.log(`   Experiment: ${this.config?.experiment}`);
      if (experimentSummary.scores) {
        Object.entries(experimentSummary.scores).forEach(([name, stats]) => {
          console.log(`   ${name}: ${(stats.mean * 100).toFixed(1)}% (±${(stats.std * 100).toFixed(1)}%)`);
        });
      }

      return experimentSummary;
    } catch (error) {
      console.warn(`⚠️  Failed to finalize Braintrust experiment: ${error}`);
      return null;
    }
  }

  /**
   * Get the Braintrust experiment URL
   */
  getExperimentUrl(): string | null {
    if (!this.enabled || !this.config) return null;
    // URL format: /app/{org}/p/{project}/experiments/{experiment}
    const org = this.config.org || 'BO';
    return `https://www.braintrust.dev/app/${org}/p/${this.config.project}/experiments/${this.config.experiment}`;
  }
}
