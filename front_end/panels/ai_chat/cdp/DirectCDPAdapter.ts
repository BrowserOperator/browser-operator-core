/**
 * Direct CDP Adapter - Wraps direct CDP connections for Node.js/eval runner context
 *
 * This adapter works with any CDP client that implements a simple send() interface:
 * - chrome-remote-interface
 * - Puppeteer CDPSession
 * - Raw WebSocket wrapper
 *
 * This allows shared tool implementations to work outside of DevTools.
 */

import type {CDPSessionAdapter, CDPAgent, CDPDomain} from './CDPSessionAdapter.js';

/**
 * Interface for any CDP client that can send commands
 * This is compatible with:
 * - chrome-remote-interface (client.send(method, params))
 * - Puppeteer CDPSession (session.send(method, params))
 */
export interface CDPClient {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/**
 * Normalizes an error to a consistent message format
 */
function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Creates a CDPAgent for a specific domain using a CDP client
 */
function createDomainAgent(client: CDPClient, domain: CDPDomain): CDPAgent {
  return {
    async invoke<T>(method: string, params?: Record<string, unknown>): Promise<T> {
      const fullMethod = `${domain}.${method}`;
      try {
        const result = await client.send(fullMethod, params || {});
        return result as T;
      } catch (error) {
        throw new Error(`CDP ${fullMethod} failed: ${normalizeError(error)}`);
      }
    },
  };
}

/**
 * DirectCDPAdapter implements CDPSessionAdapter for direct CDP connections
 *
 * Usage with chrome-remote-interface:
 * ```typescript
 * import CDP from 'chrome-remote-interface';
 * const client = await CDP({ port: 9222 });
 * const adapter = new DirectCDPAdapter(client, 'https://example.com');
 * ```
 *
 * Usage with Puppeteer:
 * ```typescript
 * const cdpSession = await page.createCDPSession();
 * const adapter = new DirectCDPAdapter(cdpSession, page.url());
 * ```
 */
export class DirectCDPAdapter implements CDPSessionAdapter {
  private readonly client: CDPClient;
  private url: string|undefined;
  private readonly agentCache = new Map<CDPDomain, CDPAgent>();

  constructor(client: CDPClient, url?: string) {
    this.client = client;
    this.url = url;
  }

  getAgent(domain: CDPDomain): CDPAgent {
    // Return cached agent if available
    const cached = this.agentCache.get(domain);
    if (cached) {
      return cached;
    }

    // Create and cache
    const agent = createDomainAgent(this.client, domain);
    this.agentCache.set(domain, agent);
    return agent;
  }

  // Convenience methods delegate to getAgent
  domAgent(): CDPAgent {
    return this.getAgent('DOM');
  }

  runtimeAgent(): CDPAgent {
    return this.getAgent('Runtime');
  }

  pageAgent(): CDPAgent {
    return this.getAgent('Page');
  }

  accessibilityAgent(): CDPAgent {
    return this.getAgent('Accessibility');
  }

  inputAgent(): CDPAgent {
    return this.getAgent('Input');
  }

  inspectedURL(): string|undefined {
    return this.url;
  }

  /**
   * Update the URL (useful after navigation)
   */
  updateURL(url: string): void {
    this.url = url;
  }

  async send<T>(domain: string, method: string, params?: Record<string, unknown>): Promise<T> {
    return this.getAgent(domain as CDPDomain).invoke<T>(method, params);
  }
}
