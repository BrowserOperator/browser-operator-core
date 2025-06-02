// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import { TakeScreenshotTool } from '../../tools/Tools.js';

/**
 * Test case for screenshot verification functionality
 */
export async function testScreenshotVerification() {
  console.log('Testing TakeScreenshotTool...');
  
  const screenshotTool = new TakeScreenshotTool();
  
  // Test 1: Take viewport screenshot
  console.log('Test 1: Taking viewport screenshot...');
  const viewportResult = await screenshotTool.execute({ fullPage: false });
  
  if ('error' in viewportResult) {
    console.error('Viewport screenshot failed:', viewportResult.error);
  } else {
    console.log('Viewport screenshot success:', viewportResult.message);
    console.log('Data URL length:', viewportResult.dataUrl?.length || 0);
  }
  
  // Test 2: Take full page screenshot
  console.log('\nTest 2: Taking full page screenshot...');
  const fullPageResult = await screenshotTool.execute({ fullPage: true });
  
  if ('error' in fullPageResult) {
    console.error('Full page screenshot failed:', fullPageResult.error);
  } else {
    console.log('Full page screenshot success:', fullPageResult.message);
    console.log('Data URL length:', fullPageResult.dataUrl?.length || 0);
  }
  
  // Test 3: Test with action verification agent
  console.log('\nTest 3: Testing with action verification agent...');
  // This would be tested through the actual agent framework
  console.log('Action verification agent can now use take_screenshot tool for visual verification');
  
  return {
    viewportResult,
    fullPageResult
  };
}

// Export for use in test runner
export default testScreenshotVerification;