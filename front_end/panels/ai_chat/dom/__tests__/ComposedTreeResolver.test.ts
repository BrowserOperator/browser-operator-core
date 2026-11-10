// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import {
  parseHopNotation,
  parseXPathToSteps,
  buildXPathFromSteps,
  isIframeStep,
} from '../ComposedTreeResolver.js';

describe('ComposedTreeResolver', () => {
  describe('parseHopNotation', () => {
    it('should return empty hops for simple selector', () => {
      const result = parseHopNotation('#button');
      assert.deepStrictEqual(result, {frameHops: [], finalSelector: '#button'});
    });

    it('should return empty hops for plain CSS selector', () => {
      const result = parseHopNotation('button.submit');
      assert.deepStrictEqual(result, {frameHops: [], finalSelector: 'button.submit'});
    });

    it('should parse single hop', () => {
      const result = parseHopNotation('iframe#frame1 >> #button');
      assert.deepStrictEqual(result, {
        frameHops: ['iframe#frame1'],
        finalSelector: '#button',
      });
    });

    it('should parse multiple hops', () => {
      const result = parseHopNotation('iframe#outer >> iframe#inner >> button.submit');
      assert.deepStrictEqual(result, {
        frameHops: ['iframe#outer', 'iframe#inner'],
        finalSelector: 'button.submit',
      });
    });

    it('should handle whitespace around >>', () => {
      const result = parseHopNotation('iframe >>   #button');
      assert.deepStrictEqual(result, {
        frameHops: ['iframe'],
        finalSelector: '#button',
      });
    });

    it('should handle no whitespace around >>', () => {
      const result = parseHopNotation('iframe>>#button');
      assert.deepStrictEqual(result, {
        frameHops: ['iframe'],
        finalSelector: '#button',
      });
    });

    it('should handle XPath in hops', () => {
      const result = parseHopNotation('//iframe[1] >> /html/body/button');
      assert.deepStrictEqual(result, {
        frameHops: ['//iframe[1]'],
        finalSelector: '/html/body/button',
      });
    });

    it('should handle empty string', () => {
      const result = parseHopNotation('');
      assert.deepStrictEqual(result, {frameHops: [], finalSelector: ''});
    });

    it('should trim leading and trailing whitespace', () => {
      const result = parseHopNotation('  #button  ');
      assert.deepStrictEqual(result, {frameHops: [], finalSelector: '#button'});
    });
  });

  describe('parseXPathToSteps', () => {
    it('should parse child axis /', () => {
      const steps = parseXPathToSteps('/html/body/div');
      assert.strictEqual(steps.length, 3);
      assert.strictEqual(steps[0].axis, 'child');
      assert.strictEqual(steps[0].name, 'html');
      assert.strictEqual(steps[1].axis, 'child');
      assert.strictEqual(steps[1].name, 'body');
      assert.strictEqual(steps[2].axis, 'child');
      assert.strictEqual(steps[2].name, 'div');
    });

    it('should parse descendant axis //', () => {
      const steps = parseXPathToSteps('//div//span');
      assert.strictEqual(steps.length, 2);
      assert.strictEqual(steps[0].axis, 'desc');
      assert.strictEqual(steps[0].name, 'div');
      assert.strictEqual(steps[1].axis, 'desc');
      assert.strictEqual(steps[1].name, 'span');
    });

    it('should handle mixed child and descendant axes', () => {
      const steps = parseXPathToSteps('/html/body//div/button');
      assert.strictEqual(steps.length, 4);
      assert.strictEqual(steps[0].axis, 'child');
      assert.strictEqual(steps[0].name, 'html');
      assert.strictEqual(steps[1].axis, 'child');
      assert.strictEqual(steps[1].name, 'body');
      assert.strictEqual(steps[2].axis, 'desc');
      assert.strictEqual(steps[2].name, 'div');
      assert.strictEqual(steps[3].axis, 'child');
      assert.strictEqual(steps[3].name, 'button');
    });

    it('should extract tag names without predicates', () => {
      const steps = parseXPathToSteps('/div[1]/span[2]/button[3]');
      assert.strictEqual(steps[0].name, 'div');
      assert.strictEqual(steps[1].name, 'span');
      assert.strictEqual(steps[2].name, 'button');
    });

    it('should preserve raw step text including predicates', () => {
      const steps = parseXPathToSteps('/div[1]/span[@class="foo"]');
      assert.strictEqual(steps[0].raw, 'div[1]');
      assert.strictEqual(steps[1].raw, 'span[@class="foo"]');
    });

    it('should handle indexed steps [n]', () => {
      const steps = parseXPathToSteps('/html/body/div[5]');
      assert.strictEqual(steps.length, 3);
      assert.strictEqual(steps[2].raw, 'div[5]');
      assert.strictEqual(steps[2].name, 'div');
    });

    it('should strip xpath= prefix', () => {
      const steps = parseXPathToSteps('xpath=/html/body');
      assert.strictEqual(steps.length, 2);
      assert.strictEqual(steps[0].name, 'html');
      assert.strictEqual(steps[1].name, 'body');
    });

    it('should strip XPATH= prefix (case insensitive)', () => {
      const steps = parseXPathToSteps('XPATH=/html/body');
      assert.strictEqual(steps.length, 2);
      assert.strictEqual(steps[0].name, 'html');
    });

    it('should handle empty path', () => {
      const steps = parseXPathToSteps('');
      assert.strictEqual(steps.length, 0);
    });

    it('should handle path with only slashes', () => {
      const steps = parseXPathToSteps('///');
      assert.strictEqual(steps.length, 0);
    });

    it('should convert tag names to lowercase', () => {
      const steps = parseXPathToSteps('/HTML/BODY/DIV');
      assert.strictEqual(steps[0].name, 'html');
      assert.strictEqual(steps[1].name, 'body');
      assert.strictEqual(steps[2].name, 'div');
    });
  });

  describe('buildXPathFromSteps', () => {
    it('should reconstruct XPath from steps', () => {
      const steps = [
        {axis: 'child' as const, raw: 'html', name: 'html'},
        {axis: 'child' as const, raw: 'body', name: 'body'},
        {axis: 'child' as const, raw: 'div', name: 'div'},
      ];
      const result = buildXPathFromSteps(steps);
      assert.strictEqual(result, '/html/body/div');
    });

    it('should handle mixed child/descendant axes', () => {
      const steps = [
        {axis: 'child' as const, raw: 'html', name: 'html'},
        {axis: 'desc' as const, raw: 'div', name: 'div'},
        {axis: 'child' as const, raw: 'button', name: 'button'},
      ];
      const result = buildXPathFromSteps(steps);
      assert.strictEqual(result, '/html//div/button');
    });

    it('should preserve predicates in raw text', () => {
      const steps = [
        {axis: 'child' as const, raw: 'div[1]', name: 'div'},
        {axis: 'child' as const, raw: 'span[2]', name: 'span'},
      ];
      const result = buildXPathFromSteps(steps);
      assert.strictEqual(result, '/div[1]/span[2]');
    });

    it('should return / for empty steps', () => {
      const result = buildXPathFromSteps([]);
      assert.strictEqual(result, '/');
    });

    it('should handle descendant-only path', () => {
      const steps = [
        {axis: 'desc' as const, raw: 'button', name: 'button'},
      ];
      const result = buildXPathFromSteps(steps);
      assert.strictEqual(result, '//button');
    });
  });

  describe('isIframeStep', () => {
    it('should return true for iframe', () => {
      const step = {axis: 'child' as const, raw: 'iframe', name: 'iframe'};
      assert.isTrue(isIframeStep(step));
    });

    it('should return true for iframe[1]', () => {
      const step = {axis: 'child' as const, raw: 'iframe[1]', name: 'iframe'};
      assert.isTrue(isIframeStep(step));
    });

    it('should return true for iframe[123]', () => {
      const step = {axis: 'child' as const, raw: 'iframe[123]', name: 'iframe[123]'};
      assert.isTrue(isIframeStep(step));
    });

    it('should be case insensitive', () => {
      const step1 = {axis: 'child' as const, raw: 'IFRAME', name: 'iframe'};
      const step2 = {axis: 'child' as const, raw: 'IFrame', name: 'iframe'};
      assert.isTrue(isIframeStep(step1));
      assert.isTrue(isIframeStep(step2));
    });

    it('should return false for div', () => {
      const step = {axis: 'child' as const, raw: 'div', name: 'div'};
      assert.isFalse(isIframeStep(step));
    });

    it('should return false for frame (not iframe)', () => {
      const step = {axis: 'child' as const, raw: 'frame', name: 'frame'};
      assert.isFalse(isIframeStep(step));
    });

    it('should return false for iframex', () => {
      const step = {axis: 'child' as const, raw: 'iframex', name: 'iframex'};
      assert.isFalse(isIframeStep(step));
    });

    it('should return false for button', () => {
      const step = {axis: 'child' as const, raw: 'button', name: 'button'};
      assert.isFalse(isIframeStep(step));
    });
  });
});
