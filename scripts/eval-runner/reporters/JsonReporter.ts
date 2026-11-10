/**
 * JSON Reporter - Outputs results as JSON file
 */

import fs from 'fs';
import type { RunSummary } from '../types.ts';

export class JsonReporter {
  private outputPath?: string;

  constructor(outputPath?: string) {
    this.outputPath = outputPath;
  }

  generate(summary: RunSummary): void {
    const output = {
      experiment: summary.experiment,
      timestamp: summary.startTime.toISOString(),
      duration: summary.duration,
      summary: {
        total: summary.total,
        passed: summary.passed,
        failed: summary.failed,
        errors: summary.errors,
        skipped: summary.skipped,
        passRate: summary.total > 0 ? summary.passed / summary.total : 0,
        averageScore: summary.averageScore,
        averageDuration: summary.averageDuration,
      },
      // Exclude 'output' field from results (can be large/verbose)
      results: summary.results.map(({ output: _, ...rest }) => rest),
    };

    const jsonString = JSON.stringify(output, null, 2);

    if (this.outputPath) {
      fs.writeFileSync(this.outputPath, jsonString);
      console.log(`\n📄 JSON report written to: ${this.outputPath}`);
    } else {
      console.log('\n' + jsonString);
    }
  }
}
