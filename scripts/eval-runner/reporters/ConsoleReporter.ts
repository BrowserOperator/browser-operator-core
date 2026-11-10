/**
 * Console Reporter - Formats results for terminal output
 */

import { getStatusIcon, type RunSummary, type TestResult } from '../types.ts';

export class ConsoleReporter {
  private verbose: boolean;

  constructor(verbose: boolean = false) {
    this.verbose = verbose;
  }

  generate(summary: RunSummary): void {
    console.log('\n' + '═'.repeat(60));
    console.log('                    DETAILED RESULTS');
    console.log('═'.repeat(60) + '\n');

    for (const result of summary.results) {
      this.printResult(result);
    }
  }

  private printResult(result: TestResult): void {
    const icon = getStatusIcon(result.status);
    const score = result.score !== undefined ? ` [${(result.score * 100).toFixed(0)}%]` : '';

    console.log(`${icon} ${result.testName}${score}`);
    console.log(`   ID: ${result.testId}`);
    console.log(`   Duration: ${(result.duration / 1000).toFixed(2)}s`);

    if (result.error) {
      console.log(`   ⚠️  Error: ${result.error}`);
    }

    if (this.verbose && result.validation) {
      console.log(`   Explanation: ${result.validation.explanation}`);

      if (result.validation.criteria && result.validation.criteria.length > 0) {
        console.log('   Criteria:');
        for (const c of result.validation.criteria) {
          const cIcon = c.passed ? '✓' : '✗';
          console.log(`     ${cIcon} ${c.criterion}`);
          if (this.verbose && c.explanation) {
            console.log(`       └─ ${c.explanation}`);
          }
        }
      }
    }

    if (result.screenshots) {
      if (result.screenshots.before) {
        console.log(`   📸 Before: ${result.screenshots.before}`);
      }
      if (result.screenshots.after) {
        console.log(`   📸 After: ${result.screenshots.after}`);
      }
    }

    console.log('');
  }
}
