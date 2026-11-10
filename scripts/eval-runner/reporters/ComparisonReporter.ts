/**
 * Comparison Reporter - Generates side-by-side comparison of v0 vs v1 results
 */

import type {
  TestResult,
  ComparisonSummary,
  TestComparisonResult,
  ExecutionMetrics,
} from '../types.ts';

export class ComparisonReporter {
  private verbose: boolean;

  constructor(verbose: boolean = false) {
    this.verbose = verbose;
  }

  /**
   * Generate comparison summary from v0 and v1 results
   */
  generateComparison(v0Results: TestResult[], v1Results: TestResult[]): ComparisonSummary {
    // Build lookup map for v1 results by testId
    const v1Map = new Map<string, TestResult>();
    for (const result of v1Results) {
      v1Map.set(result.testId, result);
    }

    const comparisons: TestComparisonResult[] = [];
    let improved = 0;
    let regressed = 0;
    let unchanged = 0;

    // Compare each v0 result with corresponding v1
    for (const v0Result of v0Results) {
      const v1Result = v1Map.get(v0Result.testId);
      if (!v1Result) continue;

      const comparison = this.compareResults(v0Result, v1Result);
      comparisons.push(comparison);

      if (comparison.delta.status === 'improved') improved++;
      else if (comparison.delta.status === 'regressed') regressed++;
      else unchanged++;
    }

    // Calculate aggregate stats
    const v0Stats = this.calculateAggregateStats(v0Results);
    const v1Stats = this.calculateAggregateStats(v1Results);

    return {
      totalTests: comparisons.length,
      v0: v0Stats,
      v1: v1Stats,
      delta: {
        passRateDelta: v1Stats.passRate - v0Stats.passRate,
        durationDeltaPercent: this.calcPercentDelta(v0Stats.avgDuration, v1Stats.avgDuration),
        toolCallsDeltaPercent: this.calcPercentDelta(v0Stats.avgToolCalls, v1Stats.avgToolCalls),
        llmCallsDeltaPercent: this.calcPercentDelta(v0Stats.avgLLMCalls, v1Stats.avgLLMCalls),
        tokensDeltaPercent: this.calcPercentDelta(v0Stats.avgTokens, v1Stats.avgTokens),
        iterationsDeltaPercent: this.calcPercentDelta(v0Stats.avgIterations, v1Stats.avgIterations),
        scoreDelta: v1Stats.avgScore - v0Stats.avgScore,
      },
      improved,
      regressed,
      unchanged,
      results: comparisons,
    };
  }

  /**
   * Print comparison summary to console
   */
  printComparison(summary: ComparisonSummary): void {
    console.log('\n' + '═'.repeat(70));
    console.log('              VERSION COMPARISON: v0 (baseline) vs v1 (current)');
    console.log('═'.repeat(70) + '\n');

    // Overall summary table
    console.log('┌────────────────────┬─────────────────┬─────────────────┬──────────────┐');
    console.log('│ Metric             │ v0 (baseline)   │ v1 (current)    │ Delta        │');
    console.log('├────────────────────┼─────────────────┼─────────────────┼──────────────┤');

    this.printRow('Pass Rate',
      `${(summary.v0.passRate * 100).toFixed(1)}%`,
      `${(summary.v1.passRate * 100).toFixed(1)}%`,
      this.formatDelta(summary.delta.passRateDelta * 100, '%', true));

    this.printRow('Avg Duration',
      `${summary.v0.avgDuration.toFixed(0)}ms`,
      `${summary.v1.avgDuration.toFixed(0)}ms`,
      this.formatDelta(summary.delta.durationDeltaPercent, '%', false));

    this.printRow('Avg Tool Calls',
      summary.v0.avgToolCalls.toFixed(1),
      summary.v1.avgToolCalls.toFixed(1),
      this.formatDelta(summary.delta.toolCallsDeltaPercent, '%', false));

    this.printRow('Avg LLM Calls',
      summary.v0.avgLLMCalls.toFixed(1),
      summary.v1.avgLLMCalls.toFixed(1),
      this.formatDelta(summary.delta.llmCallsDeltaPercent, '%', false));

    this.printRow('Avg Tokens',
      summary.v0.avgTokens.toFixed(0),
      summary.v1.avgTokens.toFixed(0),
      this.formatDelta(summary.delta.tokensDeltaPercent, '%', false));

    this.printRow('Avg Iterations',
      summary.v0.avgIterations.toFixed(1),
      summary.v1.avgIterations.toFixed(1),
      this.formatDelta(summary.delta.iterationsDeltaPercent, '%', false));

    this.printRow('Avg Score',
      `${(summary.v0.avgScore * 100).toFixed(1)}%`,
      `${(summary.v1.avgScore * 100).toFixed(1)}%`,
      this.formatDelta(summary.delta.scoreDelta * 100, '%', true));

    console.log('└────────────────────┴─────────────────┴─────────────────┴──────────────┘');

    // Status summary
    console.log('\nStatus Summary:');
    console.log(`  ✅ Improved: ${summary.improved} tests`);
    console.log(`  ❌ Regressed: ${summary.regressed} tests`);
    console.log(`  ➖ Unchanged: ${summary.unchanged} tests`);

    // Per-test details if verbose
    if (this.verbose && summary.results.length > 0) {
      console.log('\n' + '─'.repeat(70));
      console.log('                         PER-TEST BREAKDOWN');
      console.log('─'.repeat(70) + '\n');

      for (const result of summary.results) {
        this.printTestComparison(result);
      }
    }
  }

  /**
   * Export comparison to JSON
   */
  toJSON(summary: ComparisonSummary): string {
    return JSON.stringify(summary, null, 2);
  }

  private compareResults(v0: TestResult, v1: TestResult): TestComparisonResult {
    const v0Metrics = v0.metrics || this.emptyMetrics();
    const v1Metrics = v1.metrics || this.emptyMetrics();

    // Determine status based on key metrics
    let status: 'improved' | 'regressed' | 'unchanged';
    const v0Passed = v0.status === 'passed';
    const v1Passed = v1.status === 'passed';

    if (v1Passed && !v0Passed) {
      status = 'improved';
    } else if (!v1Passed && v0Passed) {
      status = 'regressed';
    } else if (v1Metrics.totalToolCalls < v0Metrics.totalToolCalls * 0.8) {
      status = 'improved'; // 20%+ reduction in tool calls
    } else if (v1Metrics.totalToolCalls > v0Metrics.totalToolCalls * 1.2) {
      status = 'regressed'; // 20%+ increase in tool calls
    } else {
      status = 'unchanged';
    }

    return {
      testId: v0.testId,
      testName: v0.testName,
      v0,
      v1,
      delta: {
        status,
        durationDelta: v1.duration - v0.duration,
        durationDeltaPercent: this.calcPercentDelta(v0.duration, v1.duration),
        scoreDelta: v1.score - v0.score,
        toolCallsDelta: v1Metrics.totalToolCalls - v0Metrics.totalToolCalls,
        llmCallsDelta: v1Metrics.totalLLMCalls - v0Metrics.totalLLMCalls,
        tokensDelta: v1Metrics.totalTokens - v0Metrics.totalTokens,
        iterationsDelta: v1Metrics.iterations - v0Metrics.iterations,
      },
    };
  }

  private calculateAggregateStats(results: TestResult[]) {
    const passed = results.filter(r => r.status === 'passed').length;
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
    const totalScore = results.reduce((sum, r) => sum + r.score, 0);

    let totalToolCalls = 0;
    let totalLLMCalls = 0;
    let totalTokens = 0;
    let totalIterations = 0;

    for (const r of results) {
      if (r.metrics) {
        totalToolCalls += r.metrics.totalToolCalls;
        totalLLMCalls += r.metrics.totalLLMCalls;
        totalTokens += r.metrics.totalTokens;
        totalIterations += r.metrics.iterations;
      }
    }

    const count = results.length || 1;
    return {
      passRate: passed / count,
      avgDuration: totalDuration / count,
      avgToolCalls: totalToolCalls / count,
      avgLLMCalls: totalLLMCalls / count,
      avgTokens: totalTokens / count,
      avgIterations: totalIterations / count,
      avgScore: totalScore / count,
    };
  }

  private calcPercentDelta(baseline: number, current: number): number {
    if (baseline === 0) return current === 0 ? 0 : 100;
    return ((current - baseline) / baseline) * 100;
  }

  private formatDelta(value: number, suffix: string, higherIsBetter: boolean): string {
    const sign = value > 0 ? '+' : '';
    const indicator = value === 0 ? '' :
                     (higherIsBetter ? (value > 0 ? '↑' : '↓') :
                                       (value < 0 ? '↑' : '↓'));
    return `${sign}${value.toFixed(1)}${suffix} ${indicator}`;
  }

  private printRow(label: string, v0: string, v1: string, delta: string): void {
    const pad = (s: string, len: number) => s.padEnd(len);
    console.log(`│ ${pad(label, 18)} │ ${pad(v0, 15)} │ ${pad(v1, 15)} │ ${pad(delta, 12)} │`);
  }

  private printTestComparison(result: TestComparisonResult): void {
    const statusIcon = result.delta.status === 'improved' ? '✅' :
                      result.delta.status === 'regressed' ? '❌' : '➖';

    console.log(`${statusIcon} ${result.testName}`);
    console.log(`   ID: ${result.testId}`);
    console.log(`   Status: v0=${result.v0.status}, v1=${result.v1.status}`);
    console.log(`   Duration: v0=${result.v0.duration}ms, v1=${result.v1.duration}ms (${this.formatDelta(result.delta.durationDeltaPercent, '%', false).trim()})`);

    if (result.v0.metrics && result.v1.metrics) {
      console.log(`   Tool Calls: v0=${result.v0.metrics.totalToolCalls}, v1=${result.v1.metrics.totalToolCalls} (${result.delta.toolCallsDelta >= 0 ? '+' : ''}${result.delta.toolCallsDelta})`);
      console.log(`   Iterations: v0=${result.v0.metrics.iterations}, v1=${result.v1.metrics.iterations}`);

      if (this.verbose) {
        console.log(`   Tokens: v0=${result.v0.metrics.totalTokens}, v1=${result.v1.metrics.totalTokens}`);
        console.log(`   Tool breakdown v0: ${this.formatToolCounts(result.v0.metrics.toolCallsByName)}`);
        console.log(`   Tool breakdown v1: ${this.formatToolCounts(result.v1.metrics.toolCallsByName)}`);
      }
    }
    console.log('');
  }

  private formatToolCounts(counts: Record<string, number>): string {
    return Object.entries(counts)
      .map(([name, count]) => `${name}(${count})`)
      .join(', ') || 'none';
  }

  private emptyMetrics(): ExecutionMetrics {
    return {
      toolCalls: [],
      llmCalls: [],
      totalToolCalls: 0,
      totalLLMCalls: 0,
      totalDurationMs: 0,
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      iterations: 0,
      toolCallsByName: {},
    };
  }
}
