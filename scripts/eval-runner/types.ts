/**
 * Types for the CLI Evaluation Runner
 */

export interface CLIOptions {
  // Test selection
  tool?: string;
  toolOverride?: string;  // Override tool for execution (run action_agent tests with action_agent_v2)
  tags?: string[];
  testIds?: string[];

  // Execution
  parallel: boolean;
  concurrency: number;
  timeout: number;
  retries: number;
  limit?: number;

  // Search tool strategy (for A/B testing)
  searchStrategy?: 'xpath-schema' | 'semantic-xpath' | 'encoded-id' | 'text-pattern';

  // Braintrust
  experiment?: string;
  project?: string;
  org?: string;
  braintrustApiKey?: string;

  // LLM Configuration
  provider: 'openai' | 'anthropic' | 'litellm' | 'cerebras';
  model: string;
  judgeProvider: 'openai' | 'anthropic' | 'litellm' | 'cerebras';
  judgeModel: string;
  apiKey?: string;
  judgeApiKey?: string;

  // Output
  format: 'console' | 'json' | 'markdown';
  output?: string;
  verbose: boolean;
  screenshots: boolean;
  screenshotDir: string;

  // Browser
  chromePath?: string;
  headless: boolean;
  remoteDebuggingPort?: number;

  // Logging
  logDir: string;
  detailedLogs: boolean;

  // Version comparison
  compare?: boolean;
}

export interface TestCase {
  id: string;
  name: string;
  description: string;
  url: string;
  tool: string;
  input: Record<string, unknown>;
  validation: ValidationConfig;
  metadata: {
    tags: string[];
    timeout?: number;
    retries?: number;
    flaky?: boolean;
    /** CSS selector to wait for visibility after navigation (for dynamic content like modals) */
    waitForSelector?: string;
    /** Delay in ms after navigation (alternative to waitForSelector) */
    waitAfterNavigation?: number;
  };
}

export interface ValidationConfig {
  type: 'snapshot' | 'llm-judge' | 'hybrid';
  llmJudge?: {
    criteria: string[];
    model?: string;
    temperature?: number;
    visualVerification?: {
      enabled: boolean;
      captureBeforeAction?: boolean;
      captureAfterAction?: boolean;
      verificationPrompts?: string[];
    };
  };
}

/**
 * Detailed metrics for a single tool call
 */
export interface ToolCallMetric {
  name: string;
  durationMs: number;
  success: boolean;
  error?: string;
  inputTokenEstimate?: number;
  outputTokenEstimate?: number;
}

/**
 * Detailed metrics for a single LLM call
 */
export interface LLMCallMetric {
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  toolCallsRequested: number;
}

/**
 * Aggregated execution metrics for comparison
 */
export interface ExecutionMetrics {
  toolCalls: ToolCallMetric[];
  llmCalls: LLMCallMetric[];
  totalToolCalls: number;
  totalLLMCalls: number;
  totalDurationMs: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  iterations: number;
  toolCallsByName: Record<string, number>;
}

export interface TestResult {
  testId: string;
  testName: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  score: number;
  duration: number;
  output?: unknown;
  error?: string;
  validation?: {
    passed: boolean;
    score: number;
    explanation: string;
    criteria: CriteriaResult[];
  };
  screenshots?: {
    before?: string;
    after?: string;
  };
  metadata?: Record<string, unknown>;
  /** Detailed execution metrics for comparison */
  metrics?: ExecutionMetrics;
}

export interface CriteriaResult {
  criterion: string;
  passed: boolean;
  explanation: string;
}

export interface RunSummary {
  experiment?: string;
  startTime: Date;
  endTime: Date;
  duration: number;
  total: number;
  passed: number;
  failed: number;
  errors: number;
  skipped: number;
  averageScore: number;
  averageDuration: number;
  results: TestResult[];
}

export interface BraintrustConfig {
  apiKey: string;
  org: string;
  project: string;
  experiment: string;
  metadata?: Record<string, unknown>;
}

/**
 * Get status icon for test result display
 */
export function getStatusIcon(status: TestResult['status']): string {
  const icons: Record<TestResult['status'], string> = {
    passed: '✅',
    failed: '❌',
    error: '💥',
    skipped: '⏭️',
  };
  return icons[status] ?? '❓';
}

export type LLMProvider = 'openai' | 'anthropic' | 'litellm' | 'cerebras' | 'groq';

interface ProviderConfig {
  apiKey: string | undefined;
  baseURL: string | undefined;
}

/**
 * Get API key and base URL for a given LLM provider
 */
export function getProviderConfig(provider: LLMProvider, explicitApiKey?: string): ProviderConfig {
  switch (provider) {
    case 'cerebras':
      return {
        apiKey: explicitApiKey || process.env.CEREBRAS_API_KEY,
        baseURL: 'https://api.cerebras.ai/v1',
      };
    case 'anthropic':
      return {
        apiKey: explicitApiKey || process.env.ANTHROPIC_API_KEY,
        baseURL: undefined,
      };
    case 'groq':
      return {
        apiKey: explicitApiKey || process.env.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1',
      };
    case 'litellm':
      return {
        apiKey: explicitApiKey || process.env.OPENAI_API_KEY,
        baseURL: process.env.LITELLM_BASE_URL,
      };
    case 'openai':
    default:
      return {
        apiKey: explicitApiKey || process.env.OPENAI_API_KEY,
        baseURL: undefined,
      };
  }
}

/**
 * Comparison result for a single test across versions
 */
export interface TestComparisonResult {
  testId: string;
  testName: string;
  v0: TestResult;
  v1: TestResult;
  delta: {
    status: 'improved' | 'regressed' | 'unchanged';
    durationDelta: number;
    durationDeltaPercent: number;
    scoreDelta: number;
    toolCallsDelta: number;
    llmCallsDelta: number;
    tokensDelta: number;
    iterationsDelta: number;
  };
}

/**
 * Overall comparison summary across all tests
 */
export interface ComparisonSummary {
  totalTests: number;
  v0: {
    passRate: number;
    avgDuration: number;
    avgToolCalls: number;
    avgLLMCalls: number;
    avgTokens: number;
    avgIterations: number;
    avgScore: number;
  };
  v1: {
    passRate: number;
    avgDuration: number;
    avgToolCalls: number;
    avgLLMCalls: number;
    avgTokens: number;
    avgIterations: number;
    avgScore: number;
  };
  delta: {
    passRateDelta: number;
    durationDeltaPercent: number;
    toolCallsDeltaPercent: number;
    llmCallsDeltaPercent: number;
    tokensDeltaPercent: number;
    iterationsDeltaPercent: number;
    scoreDelta: number;
  };
  improved: number;
  regressed: number;
  unchanged: number;
  results: TestComparisonResult[];
}
