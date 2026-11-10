# CLI Evaluation Runner

A scalable command-line evaluation runner for Browser Operator agents with Braintrust experiment tracking.

## Features

- Run action-agent, web-task-agent, and other evaluations from CLI
- Braintrust SDK integration for experiment tracking
- Filter tests by tag, tool, or test ID
- Parallel execution support with configurable concurrency
- Multiple output formats (console, JSON, markdown)
- Screenshot capture for visual verification
- LLM-based evaluation judge
- Automatic Chrome detection

## Installation

```bash
# Navigate to the eval-runner directory
cd scripts/eval-runner

# Install dependencies
npm install

# Set environment variables (or use .env file in project root)
export OPENAI_API_KEY=your_openai_key
export CEREBRAS_API_KEY=your_cerebras_key  # For Cerebras models
export BRAINTRUST_API_KEY=your_braintrust_key  # Optional, for experiment tracking
```

## Quick Start

```bash
# From scripts/eval-runner directory:
npm run eval -- --tool action_agent --limit 2

# Or from project root:
npx tsx scripts/eval-runner/cli.ts --tool action_agent --limit 2

# Run with visible browser (not headless)
npm run eval -- --tool action_agent --no-headless

# Connect to existing Browser Operator instance (recommended for sites with bot detection)
npm run eval -- --tool action_agent --remote-debugging-port 9222
```

## Usage Examples

### Test Selection

```bash
# Run tests for a specific tool
npx tsx scripts/eval-runner/cli.ts --tool action_agent
npx tsx scripts/eval-runner/cli.ts --tool web_task_agent

# Run tests by tag (AND logic - matches all tags)
npx tsx scripts/eval-runner/cli.ts --tag shadow-dom --tag click
npx tsx scripts/eval-runner/cli.ts --tag form-fill

# Run specific test by ID
npx tsx scripts/eval-runner/cli.ts --test action-agent-click-001
npx tsx scripts/eval-runner/cli.ts --test action-agent-click-001 --test action-agent-form-001
```

### Braintrust Experiment Tracking

```bash
# Enable Braintrust tracking with experiment name
npx tsx scripts/eval-runner/cli.ts --tool action_agent --experiment "action-v1.0"

# Specify project name
npx tsx scripts/eval-runner/cli.ts --tool action_agent \
  --experiment "shadow-dom-tests" \
  --project "browser-operator-evals"
```

### Parallel Execution

```bash
# Run tests in parallel (default concurrency: 3)
npx tsx scripts/eval-runner/cli.ts --tool action_agent --parallel

# Custom concurrency
npx tsx scripts/eval-runner/cli.ts --tool action_agent --parallel --concurrency 5
```

### Output Formats

```bash
# JSON output to file
npx tsx scripts/eval-runner/cli.ts --tool action_agent --format json --output results.json

# Markdown report
npx tsx scripts/eval-runner/cli.ts --tool action_agent --format markdown --output report.md

# Verbose console output
npx tsx scripts/eval-runner/cli.ts --tool action_agent --verbose
```

### LLM Configuration

```bash
# Use different model
npx tsx scripts/eval-runner/cli.ts --tool action_agent --model gpt-4o-mini

# Use different judge model
npx tsx scripts/eval-runner/cli.ts --tool action_agent --judge-model gpt-4o

# Use Anthropic
npx tsx scripts/eval-runner/cli.ts --tool action_agent \
  --provider anthropic \
  --model claude-3-5-sonnet-20241022

# Use Cerebras (fast inference)
npx tsx scripts/eval-runner/cli.ts --tool action_agent \
  --provider cerebras \
  --model llama-3.3-70b
```

### Cerebras Models

Cerebras provides fast inference for open-source models. Available models:

| Model | Description |
|-------|-------------|
| `llama-3.3-70b` | Llama 3.3 70B - recommended for agents |
| `llama-3.1-8b` | Llama 3.1 8B - faster, less capable |
| `llama-3.1-70b` | Llama 3.1 70B |
| `zai-glm-4.6` | GLM 4.6 model |

```bash
# Example: Use Cerebras for agent, OpenAI for judge
npx tsx scripts/eval-runner/cli.ts \
  --provider cerebras --model llama-3.3-70b \
  --judge-provider openai --judge-model gpt-4o \
  --tool action_agent --limit 5 --verbose
```

Set `CEREBRAS_API_KEY` in your `.env` file or environment.

### Connecting to Existing Browser

For sites with bot detection (e.g., e-commerce sites like Home Depot, Amazon), you can connect to an existing Browser Operator instance instead of launching a new headless browser. This provides:

- **Bypass bot detection** - Uses a real browser session with cookies/authentication
- **Use authenticated sessions** - Test with logged-in user state
- **Visual debugging** - Watch the agent interact with the page in real-time

**Step 1:** Start Browser Operator with remote debugging enabled:

```bash
/Applications/Browser\ Operator.app/Contents/MacOS/Browser\ Operator \
    --disable-infobars \
    --custom-devtools-frontend=http://localhost:9000/ \
    --remote-debugging-port=9222
```

**Step 2:** Run tests connecting to the browser:

```bash
npx tsx scripts/eval-runner/cli.ts \
  --tool action_agent \
  --remote-debugging-port 9222 \
  --verbose
```

The eval runner will:
- Connect to the existing browser (not launch a new one)
- Create new tabs for each test
- Disconnect when done (browser stays open)

**Example: E-commerce test with authentication**

```bash
# 1. Start Browser Operator and log into the site manually
# 2. Run the test - it will use your authenticated session
npx tsx scripts/eval-runner/cli.ts \
  --test action-agent-ecommerce-001 \
  --remote-debugging-port 9222 \
  --provider cerebras --model zai-glm-4.6 \
  --verbose
```

## CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `-t, --tool <tool>` | Filter by tool name | - |
| `--tag <tags...>` | Filter by tags (AND logic) | - |
| `--test <ids...>` | Run specific test IDs | - |
| `-l, --limit <n>` | Limit number of tests to run | - |
| `-p, --parallel` | Run tests in parallel | `false` |
| `-c, --concurrency <n>` | Max parallel tests | `3` |
| `--timeout <ms>` | Test timeout in milliseconds | `60000` |
| `-r, --retries <n>` | Number of retries on failure | `1` |
| `-e, --experiment <name>` | Braintrust experiment name | auto-generated |
| `--project <name>` | Braintrust project name | `browser-operator` |
| `--org <name>` | Braintrust organization name | `BO` |
| `--no-braintrust` | Disable Braintrust experiment tracking | - |
| `--provider <provider>` | LLM provider (openai, anthropic, litellm, cerebras) | `openai` |
| `-m, --model <model>` | Model for agents | `gpt-4o` |
| `--judge-provider <provider>` | LLM provider for judge | `openai` |
| `--judge-model <model>` | Model for evaluation judge | `gpt-4o` |
| `-f, --format <format>` | Output format (console, json, markdown) | `console` |
| `-o, --output <file>` | Output file path | - |
| `-v, --verbose` | Verbose output | `false` |
| `--screenshots` | Capture screenshots | `true` |
| `--screenshot-dir <dir>` | Screenshot directory | `./eval-screenshots` |
| `--chrome-path <path>` | Path to Chrome executable | auto-detect |
| `--headless` | Run browser in headless mode | `true` |
| `--no-headless` | Run browser with visible UI | - |
| `--remote-debugging-port <port>` | Connect to existing browser on this port | - |

## Architecture

```
scripts/eval-runner/
├── cli.ts                 # CLI entry point with argument parsing
├── types.ts               # TypeScript type definitions
├── TestRunner.ts          # Test orchestration and execution
├── BrowserExecutor.ts     # Puppeteer/CDP browser automation
├── AgentBridge.ts         # Agent execution logic
├── LLMJudge.ts            # LLM-based evaluation judge
├── BraintrustTracker.ts   # Braintrust SDK integration
├── reporters/
│   ├── ConsoleReporter.ts # Terminal output formatting
│   ├── JsonReporter.ts    # JSON file output
│   └── MarkdownReporter.ts# Markdown report generation
└── README.md
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENAI_API_KEY` | OpenAI API key for LLM operations | Yes (or ANTHROPIC) |
| `ANTHROPIC_API_KEY` | Anthropic API key (alternative) | Optional |
| `BRAINTRUST_API_KEY` | Braintrust API key for experiment tracking | For tracking |
| `CHROME_PATH` | Path to Chrome/Chromium executable | No (auto-detect) |
| `LITELLM_BASE_URL` | LiteLLM proxy base URL | For LiteLLM |

## Braintrust Integration

When an experiment name is provided, the runner:

1. Initializes a Braintrust experiment
2. Logs each test result with:
   - Input (URL, tool, objective)
   - Output (status, agent response, validation)
   - Scores (success, score, per-criteria scores)
   - Metadata (duration, screenshots, tags)
3. Generates experiment summary with aggregate metrics
4. Provides link to view experiment in Braintrust dashboard

Example output:
```
📊 Braintrust experiment initialized: browser-operator/action-agent-v1

... test execution ...

📊 Braintrust Experiment Summary:
   Experiment: action-agent-v1
   success: 85.0% (±12.5%)
   score: 78.3% (±15.2%)

🔗 View experiment: https://www.braintrust.dev/app/browser-operator/experiments/action-agent-v1
```

## Adding New Tests

Test cases are defined in `front_end/panels/ai_chat/evaluation/test-cases/`. To add a new test:

```typescript
export const myNewTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-new-001',
  name: 'My New Test',
  description: 'What this test verifies',
  url: 'https://example.com',
  tool: 'action_agent',
  input: {
    objective: 'What the agent should do',
    reasoning: 'Why we are testing this',
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'First success criterion',
        'Second success criterion',
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
      },
    },
  },
  metadata: {
    tags: ['action', 'click', 'new-feature'],
    timeout: 45000,
  },
};
```

Then add it to the exports in `test-cases/index.ts`.
