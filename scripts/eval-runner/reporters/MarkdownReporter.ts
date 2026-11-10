/**
 * Markdown Reporter - Generates markdown report
 */

import fs from 'fs';
import { getStatusIcon, type RunSummary, type TestResult } from '../types.ts';

export class MarkdownReporter {
  private outputPath?: string;

  constructor(outputPath?: string) {
    this.outputPath = outputPath;
  }

  generate(summary: RunSummary): void {
    const lines: string[] = [];

    // Header
    lines.push('# Evaluation Report');
    lines.push('');
    lines.push(`**Date:** ${summary.startTime.toISOString()}`);
    if (summary.experiment) {
      lines.push(`**Experiment:** ${summary.experiment}`);
    }
    lines.push(`**Duration:** ${(summary.duration / 1000).toFixed(1)}s`);
    lines.push('');

    // Summary table
    lines.push('## Summary');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|-------|');
    lines.push(`| Total Tests | ${summary.total} |`);
    lines.push(`| Passed | ${summary.passed} |`);
    lines.push(`| Failed | ${summary.failed} |`);
    lines.push(`| Errors | ${summary.errors} |`);
    lines.push(`| Pass Rate | ${summary.total > 0 ? (summary.passed / summary.total * 100).toFixed(1) : 0}% |`);
    lines.push(`| Average Score | ${(summary.averageScore * 100).toFixed(1)}% |`);
    lines.push(`| Average Duration | ${(summary.averageDuration / 1000).toFixed(2)}s |`);
    lines.push('');

    // Results table
    lines.push('## Test Results');
    lines.push('');
    lines.push('| Status | Test | Score | Duration |');
    lines.push('|--------|------|-------|----------|');

    for (const result of summary.results) {
      const icon = getStatusIcon(result.status);
      const score = result.score !== undefined ? `${(result.score * 100).toFixed(0)}%` : '-';
      const duration = `${(result.duration / 1000).toFixed(2)}s`;
      lines.push(`| ${icon} | ${result.testName} | ${score} | ${duration} |`);
    }
    lines.push('');

    // Detailed results
    lines.push('## Detailed Results');
    lines.push('');

    for (const result of summary.results) {
      lines.push(this.formatDetailedResult(result));
    }

    const markdown = lines.join('\n');

    if (this.outputPath) {
      fs.writeFileSync(this.outputPath, markdown);
      console.log(`\n📄 Markdown report written to: ${this.outputPath}`);
    } else {
      console.log('\n' + markdown);
    }
  }

  private formatDetailedResult(result: TestResult): string {
    const lines: string[] = [];
    const icon = getStatusIcon(result.status);

    lines.push(`### ${icon} ${result.testName}`);
    lines.push('');
    lines.push(`- **ID:** ${result.testId}`);
    lines.push(`- **Status:** ${result.status.toUpperCase()}`);
    lines.push(`- **Score:** ${result.score !== undefined ? (result.score * 100).toFixed(0) + '%' : 'N/A'}`);
    lines.push(`- **Duration:** ${(result.duration / 1000).toFixed(2)}s`);

    if (result.error) {
      lines.push('');
      lines.push('**Error:**');
      lines.push('```');
      lines.push(result.error);
      lines.push('```');
    }

    if (result.validation?.explanation) {
      lines.push('');
      lines.push('**Evaluation:**');
      lines.push(result.validation.explanation);
    }

    if (result.validation?.criteria && result.validation.criteria.length > 0) {
      lines.push('');
      lines.push('**Criteria:**');
      for (const c of result.validation.criteria) {
        const cIcon = c.passed ? '✅' : '❌';
        lines.push(`- ${cIcon} ${c.criterion}`);
        if (c.explanation) {
          lines.push(`  - ${c.explanation}`);
        }
      }
    }

    lines.push('');
    lines.push('---');
    lines.push('');

    return lines.join('\n');
  }
}
