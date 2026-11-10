/**
 * SDK Target Adapter - Wraps SDK.Target for DevTools context
 *
 * This adapter allows shared tool implementations to work with
 * the DevTools SDK by implementing the CDPSessionAdapter interface.
 */

import * as SDK from '../../../core/sdk/sdk.js';
import type {CDPSessionAdapter, CDPAgent, CDPDomain} from './CDPSessionAdapter.js';

/**
 * Creates a CDPAgent wrapper for an SDK domain agent
 * SDK agents use invoke_methodName pattern, we translate to invoke(methodName)
 */
function wrapSDKAgent(agent: unknown): CDPAgent {
  return {
    async invoke<T>(method: string, params?: Record<string, unknown>): Promise<T> {
      const invokeMethod = `invoke_${method}`;
      const agentAny = agent as Record<string, Function>;
      if (typeof agentAny[invokeMethod] !== 'function') {
        throw new Error(`Method ${invokeMethod} not found on agent`);
      }
      const result = await agentAny[invokeMethod](params || {});
      // SDK returns protocol response which may have getError()
      if (result && typeof result.getError === 'function') {
        const error = result.getError();
        if (error) {
          throw new Error(error);
        }
      }
      return result as T;
    },
  };
}

/**
 * Map of domain names to SDK target agent getter methods
 */
const DOMAIN_TO_SDK_METHOD: Record<CDPDomain, keyof SDK.Target.Target> = {
  DOM: 'domAgent',
  Runtime: 'runtimeAgent',
  Page: 'pageAgent',
  Accessibility: 'accessibilityAgent',
  Input: 'inputAgent',
};

/**
 * SDKTargetAdapter implements CDPSessionAdapter for DevTools context
 */
export class SDKTargetAdapter implements CDPSessionAdapter {
  private readonly target: SDK.Target.Target;
  private readonly agentCache = new Map<CDPDomain, CDPAgent>();

  constructor(target: SDK.Target.Target) {
    this.target = target;
  }

  getAgent(domain: CDPDomain): CDPAgent {
    // Return cached agent if available
    const cached = this.agentCache.get(domain);
    if (cached) {
      return cached;
    }

    // Get the SDK agent using the mapped method
    const methodName = DOMAIN_TO_SDK_METHOD[domain];
    const agent = (this.target as unknown as Record<string, () => unknown>)[methodName]?.();
    if (!agent) {
      throw new Error(`${domain} agent not available`);
    }

    // Wrap and cache
    const wrapped = wrapSDKAgent(agent);
    this.agentCache.set(domain, wrapped);
    return wrapped;
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
    return this.target.inspectedURL();
  }

  async send<T>(domain: string, method: string, params?: Record<string, unknown>): Promise<T> {
    return this.getAgent(domain as CDPDomain).invoke<T>(method, params);
  }
}
