// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type { Tool } from '../../tools/Tools.js';
import type { TestCase } from './types.js';

/**
 * Generic adapter interface for integrating any tool with the evaluation framework
 */
export interface ToolAdapter<TInput = any, TOutput = any> {
  /**
   * Name of the tool this adapter handles
   */
  toolName: string;

  /**
   * Get or create the tool instance
   */
  getTool(): Tool<TInput, TOutput>;

  /**
   * Prepare the input for the tool from test case input
   */
  prepareInput(testCase: TestCase<TInput>): TInput;

  /**
   * Extract the relevant output from the tool's result
   */
  extractOutput(result: TOutput): any;

  /**
   * Sanitize output for snapshot comparison (remove dynamic fields)
   */
  sanitizeForSnapshot(output: any): any;

  /**
   * Get evaluation criteria specific to this tool
   */
  getEvaluationCriteria(testCase: TestCase<TInput>): string[];

  /**
   * Validate if the test case is properly configured for this tool
   */
  validateTestCase(testCase: TestCase<TInput>): { valid: boolean; errors?: string[] };
}

/**
 * Base adapter class with common functionality
 */
export abstract class BaseToolAdapter<TInput = any, TOutput = any> implements ToolAdapter<TInput, TOutput> {
  abstract toolName: string;
  abstract getTool(): Tool<TInput, TOutput>;
  abstract prepareInput(testCase: TestCase<TInput>): TInput;
  abstract extractOutput(result: TOutput): any;

  /**
   * Default sanitization removes timestamps and IDs
   */
  sanitizeForSnapshot(output: any): any {
    const sanitized = JSON.parse(JSON.stringify(output));
    this.sanitizeObject(sanitized);
    return sanitized;
  }

  private sanitizeObject(obj: any, path: string = ''): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => this.sanitizeObject(item, `${path}[${index}]`));
      return;
    }

    for (const key in obj) {
      const value = obj[key];
      const currentPath = path ? `${path}.${key}` : key;

      // Sanitize common dynamic fields
      if (this.isDynamicField(key, value)) {
        obj[key] = this.sanitizeDynamicValue(key, value);
      } else if (typeof value === 'object') {
        this.sanitizeObject(value, currentPath);
      }
    }
  }

  protected isDynamicField(key: string, value: any): boolean {
    const dynamicKeys = ['timestamp', 'date', 'time', 'id', 'uuid', 'sessionId', 'requestId'];
    return dynamicKeys.some(dk => key.toLowerCase().includes(dk.toLowerCase()));
  }

  protected sanitizeDynamicValue(key: string, value: any): string {
    if (key.toLowerCase().includes('timestamp')) return '[TIMESTAMP]';
    if (key.toLowerCase().includes('date')) return '[DATE]';
    if (key.toLowerCase().includes('id')) return '[ID]';
    if (key.toLowerCase().includes('url') && typeof value === 'string') {
      // Keep base URL but remove query params
      const baseUrl = value.split('?')[0];
      return baseUrl + '?[PARAMS]';
    }
    return '[DYNAMIC]';
  }

  abstract getEvaluationCriteria(testCase: TestCase<TInput>): string[];

  validateTestCase(testCase: TestCase<TInput>): { valid: boolean; errors?: string[] } {
    const errors: string[] = [];

    if (!testCase.id) {
      errors.push('Test case must have an id');
    }

    if (!testCase.url) {
      errors.push('Test case must have a URL');
    }

    if (!testCase.tool) {
      errors.push('Test case must specify a tool');
    }

    if (testCase.tool !== this.toolName) {
      errors.push(`Tool mismatch: expected ${this.toolName}, got ${testCase.tool}`);
    }

    if (!testCase.input) {
      errors.push('Test case must have input');
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}