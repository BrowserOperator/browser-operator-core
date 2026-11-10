/**
 * DOM Test Executor
 *
 * Executes DOM-specific tests using CDP, including shadow piercer,
 * iframe handling, accessibility tree, and slider interactions.
 */

import type { ExecutionContext } from './BrowserExecutor.ts';
import { SHADOW_PIERCER_RUNTIME, type DOMTestCase, type DOMAssertion } from './test-cases/dom-tests.ts';

export interface DOMTestResult {
  success: boolean;
  assertions: AssertionResult[];
  data?: Record<string, unknown>;
  error?: string;
}

export interface AssertionResult {
  description: string;
  passed: boolean;
  data?: unknown;
  error?: string;
}

/**
 * DOMTestExecutor runs DOM-specific tests
 */
export class DOMTestExecutor {
  /**
   * Execute a DOM test case
   */
  async execute(testCase: DOMTestCase, context: ExecutionContext): Promise<DOMTestResult> {
    const { page, cdp } = context;
    const assertions: AssertionResult[] = [];
    const data: Record<string, unknown> = {};

    try {
      // Inject shadow piercer runtime
      await this.injectShadowPiercer(page);

      // Run setup if provided
      if (testCase.domTest.setup) {
        await page.evaluate(testCase.domTest.setup);
        await new Promise(resolve => setTimeout(resolve, 500)); // Wait for setup
      }

      // Execute based on test type
      switch (testCase.domTest.type) {
        case 'shadow-piercer':
          await this.executeShadowPiercerTest(testCase, context, assertions, data);
          break;
        case 'frame-collection':
          await this.executeFrameTest(testCase, context, assertions, data);
          break;
        case 'accessibility':
          await this.executeAccessibilityTest(testCase, context, assertions, data);
          break;
        case 'slider':
          await this.executeSliderTest(testCase, context, assertions, data);
          break;
        case 'page-analysis':
          await this.executePageAnalysisTest(testCase, context, assertions, data);
          break;
        default:
          // Run generic assertions
          await this.runAssertions(testCase.domTest.assertions, page, assertions);
      }

      const allPassed = assertions.every(a => a.passed);
      return {
        success: allPassed,
        assertions,
        data,
      };
    } catch (error) {
      return {
        success: false,
        assertions,
        data,
        error: String(error),
      };
    }
  }

  /**
   * Inject shadow piercer runtime into page
   */
  private async injectShadowPiercer(page: any): Promise<void> {
    await page.evaluate(SHADOW_PIERCER_RUNTIME);
  }

  /**
   * Run assertions in page context
   */
  private async runAssertions(
    domAssertions: DOMAssertion[],
    page: any,
    results: AssertionResult[]
  ): Promise<void> {
    for (const assertion of domAssertions) {
      try {
        const result = await page.evaluate(assertion.check);
        results.push({
          description: assertion.description,
          passed: result.passed,
          data: result.data,
        });
      } catch (error) {
        results.push({
          description: assertion.description,
          passed: false,
          error: String(error),
        });
      }
    }
  }

  /**
   * Execute shadow piercer specific test
   */
  private async executeShadowPiercerTest(
    testCase: DOMTestCase,
    context: ExecutionContext,
    assertions: AssertionResult[],
    data: Record<string, unknown>
  ): Promise<void> {
    const { page } = context;

    // Run the defined assertions
    await this.runAssertions(testCase.domTest.assertions, page, assertions);

    // Get shadow piercer stats
    const stats = await page.evaluate(() => ({
      injected: (window as any).__browserOperatorInjected,
      openCount: (window as any).__browserOperatorState?.openCount,
      closedCount: (window as any).__browserOperatorState?.closedCount,
    }));

    data.shadowPiercerStats = stats;
  }

  /**
   * Execute frame collection test
   */
  private async executeFrameTest(
    testCase: DOMTestCase,
    context: ExecutionContext,
    assertions: AssertionResult[],
    data: Record<string, unknown>
  ): Promise<void> {
    const { page, cdp } = context;

    // Run the defined assertions
    await this.runAssertions(testCase.domTest.assertions, page, assertions);

    // Get frame tree via CDP
    try {
      const { frameTree } = await cdp.send('Page.getFrameTree');
      data.frameTree = {
        mainFrameId: frameTree.frame.id,
        childFrames: frameTree.childFrames?.length || 0,
      };

      assertions.push({
        description: 'Frame tree retrieved via CDP',
        passed: true,
        data: data.frameTree,
      });
    } catch (error) {
      assertions.push({
        description: 'Frame tree retrieved via CDP',
        passed: false,
        error: String(error),
      });
    }
  }

  /**
   * Execute accessibility tree test
   */
  private async executeAccessibilityTest(
    testCase: DOMTestCase,
    context: ExecutionContext,
    assertions: AssertionResult[],
    data: Record<string, unknown>
  ): Promise<void> {
    const { cdp } = context;

    try {
      // Get full accessibility tree
      const { nodes } = await cdp.send('Accessibility.getFullAXTree');

      const buttons = nodes.filter((n: any) => n.role?.value === 'button');
      const links = nodes.filter((n: any) => n.role?.value === 'link');
      const textboxes = nodes.filter((n: any) => n.role?.value === 'textbox' || n.role?.value === 'combobox');

      data.accessibilityTree = {
        totalNodes: nodes.length,
        buttons: buttons.length,
        links: links.length,
        textboxes: textboxes.length,
      };

      assertions.push({
        description: 'Accessibility tree retrieved',
        passed: nodes.length > 0,
        data: data.accessibilityTree,
      });

      assertions.push({
        description: 'Interactive elements found',
        passed: buttons.length > 0 || links.length > 0 || textboxes.length > 0,
        data: { buttons: buttons.length, links: links.length, textboxes: textboxes.length },
      });
    } catch (error) {
      assertions.push({
        description: 'Accessibility tree retrieved',
        passed: false,
        error: String(error),
      });
    }
  }

  /**
   * Execute slider test with drag operation
   */
  private async executeSliderTest(
    testCase: DOMTestCase,
    context: ExecutionContext,
    assertions: AssertionResult[],
    data: Record<string, unknown>
  ): Promise<void> {
    const { page, cdp } = context;

    // Check if this is an iframe test
    const isIframeTest = testCase.url.includes('jqueryui.com/slider/');

    let handle: any = null;
    let handleBox: any = null;

    if (isIframeTest) {
      // Find the demo iframe
      const iframeElement = await page.$('iframe.demo-frame');
      if (!iframeElement) {
        assertions.push({
          description: 'Demo iframe found',
          passed: false,
          error: 'iframe.demo-frame not found',
        });
        return;
      }

      assertions.push({
        description: 'Demo iframe found',
        passed: true,
      });

      // Get iframe content
      const iframe = await iframeElement.contentFrame();
      if (!iframe) {
        assertions.push({
          description: 'Iframe content accessible',
          passed: false,
          error: 'Could not access iframe content',
        });
        return;
      }

      // Wait for slider
      await new Promise(resolve => setTimeout(resolve, 500));

      handle = await iframe.$('.ui-slider-handle');
      if (handle) {
        handleBox = await handle.boundingBox();
      }
    } else {
      // Direct demo page
      await new Promise(resolve => setTimeout(resolve, 500));
      handle = await page.$('.ui-slider-handle');
      if (handle) {
        handleBox = await handle.boundingBox();
      }
    }

    if (!handle || !handleBox) {
      assertions.push({
        description: 'Slider handle found',
        passed: false,
        error: 'Slider handle not found',
      });
      return;
    }

    assertions.push({
      description: 'Slider handle found',
      passed: true,
      data: { x: handleBox.x, y: handleBox.y },
    });

    const initialX = handleBox.x;
    data.initialPosition = { x: initialX, y: handleBox.y };

    // Perform drag
    const centerX = handleBox.x + handleBox.width / 2;
    const centerY = handleBox.y + handleBox.height / 2;

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: centerX,
      y: centerY,
      button: 'left',
      clickCount: 1,
    });

    // Smooth drag
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: centerX + (100 * i) / steps,
        y: centerY,
        button: 'left',
      });
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: centerX + 100,
      y: centerY,
      button: 'left',
      clickCount: 1,
    });

    // Wait and verify
    await new Promise(resolve => setTimeout(resolve, 300));

    const newBox = await handle.boundingBox();
    const moved = newBox && newBox.x > initialX;
    const movedBy = newBox ? Math.round(newBox.x - initialX) : 0;

    data.finalPosition = newBox ? { x: newBox.x, y: newBox.y } : null;
    data.movedBy = movedBy;

    assertions.push({
      description: 'Slider position changed after drag',
      passed: !!moved,
      data: { movedBy, initialX, finalX: newBox?.x },
    });
  }

  /**
   * Execute page analysis test
   */
  private async executePageAnalysisTest(
    testCase: DOMTestCase,
    context: ExecutionContext,
    assertions: AssertionResult[],
    data: Record<string, unknown>
  ): Promise<void> {
    const { page, cdp } = context;

    // Run defined assertions
    await this.runAssertions(testCase.domTest.assertions, page, assertions);

    // Get accessibility tree stats
    try {
      const { nodes } = await cdp.send('Accessibility.getFullAXTree');
      data.accessibilityNodes = nodes.length;

      const buttons = nodes.filter((n: any) => n.role?.value === 'button').length;
      const links = nodes.filter((n: any) => n.role?.value === 'link').length;

      data.analysis = {
        axNodes: nodes.length,
        buttons,
        links,
      };

      assertions.push({
        description: 'Accessibility analysis completed',
        passed: true,
        data: data.analysis,
      });
    } catch (error) {
      assertions.push({
        description: 'Accessibility analysis completed',
        passed: false,
        error: String(error),
      });
    }

    // Get DOM stats
    const domStats = await page.evaluate(() => ({
      elements: document.querySelectorAll('*').length,
      buttons: document.querySelectorAll('button').length,
      links: document.querySelectorAll('a').length,
      inputs: document.querySelectorAll('input').length,
      headings: document.querySelectorAll('h1, h2, h3, h4, h5, h6').length,
      images: document.querySelectorAll('img').length,
    }));

    data.domStats = domStats;
  }
}
