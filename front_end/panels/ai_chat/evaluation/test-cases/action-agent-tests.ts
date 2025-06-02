// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type { TestCase } from '../framework/types.js';

export interface ActionAgentArgs {
  objective: string;
  reasoning: string;
  hint?: string;
  input_data?: string;
}

// Basic click action test
export const basicClickTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-click-001',
  name: 'Click Search Button',
  description: 'Test clicking a search button on Google homepage',
  url: 'https://www.google.com',
  tool: 'action_agent',
  input: {
    objective: 'Click the "Google Search" button',
    reasoning: 'Testing basic click action on a well-known button element'
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Successfully identified the Google Search button element',
        'Used get_page_content to analyze the page structure',
        'Used perform_action with click method on the correct element',
        'Documented the element selection process',
        'No errors occurred during execution'
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        screenshotDelay: 3000,
        verificationPrompts: [
          'Compare before and after screenshots to verify button was clicked',
          'Check if search results page loaded or search interface changed',
          'Look for visual indicators that search action was triggered',
          'Verify no error messages or broken states are visible'
        ]
      }
    }
  },
  metadata: {
    tags: ['action', 'click', 'search', 'google', 'basic']
  }
};

// Form fill action test
export const formFillTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-form-001',
  name: 'Fill Search Query',
  description: 'Test filling a search input field with specific text',
  url: 'https://www.google.com',
  tool: 'action_agent',
  input: {
    objective: 'Fill the search box with "Chrome DevTools automation testing"',
    reasoning: 'Testing form input capability with a specific search query'
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Successfully identified the search input field',
        'Used perform_action with fill method',
        'Correctly filled the field with the specified text',
        'Verified the field accepted the input',
        'No formatting or encoding issues with the text'
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        screenshotDelay: 2000,
        verificationPrompts: [
          'Compare screenshots to confirm text was entered in the search field',
          'Verify the exact text "Chrome DevTools automation testing" is visible',
          'Check if search suggestions or autocomplete dropdown appeared',
          'Ensure no input validation errors are shown'
        ]
      }
    }
  },
  metadata: {
    tags: ['action', 'form-fill', 'input', 'google', 'basic']
  }
};

// Complex navigation test
export const navigationClickTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-nav-001',
  name: 'Navigate via Menu Click',
  description: 'Test clicking navigation menu items to navigate between pages',
  url: 'https://www.wikipedia.org',
  tool: 'action_agent',
  input: {
    objective: 'Click on the "English" language link to navigate to English Wikipedia',
    reasoning: 'Testing navigation through link clicks on a multilingual site'
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Identified the correct language link among many options',
        'Successfully clicked the English link',
        'Navigation occurred to the English Wikipedia',
        'Used appropriate tools to verify navigation success',
        'Handled the multilingual page structure correctly'
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        screenshotDelay: 5000,
        verificationPrompts: [
          'Compare screenshots to verify navigation from Wikipedia homepage to English Wikipedia',
          'Check if the page language and content changed to English',
          'Verify the URL changed to en.wikipedia.org',
          'Confirm the English Wikipedia main page is displayed'
        ]
      }
    }
  },
  metadata: {
    tags: ['action', 'navigation', 'click', 'wikipedia', 'multilingual']
  }
};

// E-commerce action test
export const ecommerceActionTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-ecommerce-001',
  name: 'Add Product to Cart',
  description: 'Test clicking "Add to Cart" button on an e-commerce product page',
  url: 'https://www.homedepot.com/p/Husky-20-Gal-Professional-Duty-Waterproof-Storage-Container-with-Hinged-Lid-in-Red-249160/313799634',
  tool: 'action_agent',
  input: {
    objective: 'Click the "Add to Cart" button for this storage container',
    reasoning: 'Testing e-commerce interaction with product cart functionality'
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Located the Add to Cart button on the product page',
        'Successfully clicked the button',
        'Handled any popups or confirmations that appeared',
        'Verified the item was added (cart count changed or confirmation shown)',
        'Dealt with page dynamics after clicking'
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        screenshotDelay: 4000,
        verificationPrompts: [
          'Compare screenshots to verify the Add to Cart button was clicked',
          'Check if cart count indicator increased or shows the item was added',
          'Look for any confirmation popup or notification about the item being added',
          'Verify the button state changed (e.g., to "Added to Cart" or disabled)'
        ]
      }
    }
  },
  metadata: {
    tags: ['action', 'ecommerce', 'click', 'homedepot', 'cart']
  }
};

// Checkbox/radio button test
export const checkboxActionTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-checkbox-001',
  name: 'Toggle Newsletter Checkbox',
  description: 'Test clicking checkbox elements for form options',
  url: 'https://www.w3schools.com/html/tryit.asp?filename=tryhtml_checkbox',
  tool: 'action_agent',
  input: {
    objective: 'Click the checkbox labeled "I have a bike" to check it',
    reasoning: 'Testing interaction with checkbox form elements'
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Identified the correct checkbox among multiple options',
        'Used click action on the checkbox element',
        'Checkbox state changed from unchecked to checked',
        'Handled the iframe structure if present',
        'No errors with form element interaction'
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        screenshotDelay: 1000,
        verificationPrompts: [
          'Compare screenshots to verify the checkbox state changed from unchecked to checked',
          'Confirm the "I have a bike" checkbox now shows a checkmark',
          'Verify the checkbox visual indicator (checkmark) is clearly visible',
          'Ensure no other checkboxes were accidentally modified'
        ]
      }
    }
  },
  metadata: {
    tags: ['action', 'checkbox', 'form', 'w3schools', 'input']
  }
};

// Dropdown selection test
export const dropdownActionTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-dropdown-001',
  name: 'Select Dropdown Option',
  description: 'Test selecting an option from a dropdown menu',
  url: 'https://www.w3schools.com/tags/tryit.asp?filename=tryhtml_select',
  tool: 'action_agent',
  input: {
    objective: 'Select "Audi" from the car brands dropdown menu',
    reasoning: 'Testing dropdown selection interaction'
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Located the dropdown/select element',
        'Identified the correct option to select',
        'Successfully selected the Audi option',
        'Dropdown value changed to the selected option',
        'Handled select element interaction properly'
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        screenshotDelay: 2000,
        verificationPrompts: [
          'Compare screenshots to verify the dropdown selection changed',
          'Confirm "Audi" is now displayed as the selected option',
          'Check if the dropdown is closed after selection',
          'Verify no other form elements were affected by the selection'
        ]
      }
    }
  },
  metadata: {
    tags: ['action', 'dropdown', 'select', 'form', 'w3schools']
  }
};

// Multi-step form test
export const multiStepFormTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-multistep-001',
  name: 'Complete Search and Submit',
  description: 'Test filling a search form and then clicking the submit button',
  url: 'https://www.bing.com',
  tool: 'action_agent',
  input: {
    objective: 'Fill the search box with "automated testing tools" and then click the search button',
    reasoning: 'Testing multi-step form interaction combining fill and click actions',
    hint: 'This requires two actions: first fill the search field, then click the search button'
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Recognized this requires multiple actions',
        'First filled the search input correctly',
        'Then located and clicked the search button',
        'Both actions completed successfully in sequence',
        'Search was initiated with the correct query'
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        screenshotDelay: 3000,
        verificationPrompts: [
          'Verify the search input contains "automated testing tools" text',
          'Confirm the search was submitted and results page loaded',
          'Check that search results are related to the query',
          'Ensure the multi-step action completed fully with both fill and click'
        ]
      }
    }
  },
  metadata: {
    tags: ['action', 'multi-step', 'form-fill', 'click', 'bing', 'search']
  }
};

// Dynamic content interaction test
export const dynamicContentTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-dynamic-001',
  name: 'Click Dynamic Load Button',
  description: 'Test clicking a button that loads dynamic content',
  url: 'https://the-internet.herokuapp.com/dynamic_loading/1',
  tool: 'action_agent',
  input: {
    objective: 'Click the "Start" button to trigger dynamic content loading',
    reasoning: 'Testing interaction with dynamically loaded content'
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Found and clicked the Start button',
        'Handled the dynamic loading process',
        'Recognized that content changes after clicking',
        'No timing issues with the dynamic content',
        'Successfully triggered the loading animation'
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        screenshotDelay: 4000,
        verificationPrompts: [
          'Compare screenshots to verify dynamic content loaded after clicking Start',
          'Check if loading animation or spinner was displayed',
          'Confirm new content appeared that was previously hidden',
          'Verify the Start button state changed or was replaced after clicking'
        ]
      }
    }
  },
  metadata: {
    tags: ['action', 'dynamic', 'click', 'ajax', 'loading']
  }
};

// Login form test
export const loginFormTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-login-001',
  name: 'Fill Login Credentials',
  description: 'Test filling username and password fields in a login form',
  url: 'https://the-internet.herokuapp.com/login',
  tool: 'action_agent',
  input: {
    objective: 'Fill the username field with "tomsmith" and password field with "SuperSecretPassword!"',
    reasoning: 'Testing form fill with multiple fields including password type',
    input_data: '<username>tomsmith</username><password>SuperSecretPassword!</password>'
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Identified both username and password fields',
        'Filled username field with correct value',
        'Filled password field with correct value', 
        'Handled password field type appropriately',
        'Used the provided input_data XML format correctly'
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        screenshotDelay: 3000,
        verificationPrompts: [
          'Verify the username field shows "tomsmith" entered',
          'Confirm the password field has dots/asterisks indicating password entry',
          'Check that both fields are properly filled before submission',
          'Ensure no validation errors are shown for the filled fields'
        ]
      }
    }
  },
  metadata: {
    tags: ['action', 'login', 'form-fill', 'authentication', 'multi-field']
  }
};

// Hover action test
export const hoverActionTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-hover-001',
  name: 'Hover to Reveal Menu',
  description: 'Test hovering over an element to reveal hidden content',
  url: 'https://the-internet.herokuapp.com/hovers',
  tool: 'action_agent',
  input: {
    objective: 'Hover over the first user avatar image to reveal the hidden caption',
    reasoning: 'Testing hover interaction to reveal dynamic content'
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Located the first user avatar image',
        'Used appropriate hover action method',
        'Successfully triggered the hover state',
        'Hidden caption became visible after hover',
        'Handled mouse interaction correctly'
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        screenshotDelay: 2000,
        verificationPrompts: [
          'Compare screenshots to verify hover revealed hidden content',
          'Check that caption or overlay appeared over the first avatar',
          'Confirm the hover state is visually active on the image',
          'Verify user information or caption text is now visible'
        ]
      }
    }
  },
  metadata: {
    tags: ['action', 'hover', 'mouse', 'dynamic', 'reveal']
  }
};

// Accessibility-focused test
export const accessibilityActionTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-a11y-001',
  name: 'Click Using ARIA Label',
  description: 'Test clicking an element identified primarily by ARIA attributes',
  url: 'https://www.w3.org/WAI/ARIA/apg/patterns/button/examples/button/',
  tool: 'action_agent',
  input: {
    objective: 'Click the button with aria-label "Print Page"',
    reasoning: 'Testing action selection using accessibility attributes'
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Used accessibility tree to find elements',
        'Correctly identified element by ARIA label',
        'Successfully clicked the target button',
        'Demonstrated understanding of accessibility attributes',
        'No reliance on visual appearance alone'
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        screenshotDelay: 2000,
        verificationPrompts: [
          'Verify the Print Page button was successfully clicked',
          'Check if any print dialog or print preview appeared',
          'Confirm the button showed visual feedback (pressed state)',
          'Ensure the action was performed on the correct accessibility-labeled element'
        ]
      }
    }
  },
  metadata: {
    tags: ['action', 'accessibility', 'aria', 'click', 'a11y']
  }
};

// Error recovery test
export const errorRecoveryTest: TestCase<ActionAgentArgs> = {
  id: 'action-agent-error-001',
  name: 'Handle Missing Element',
  description: 'Test agent behavior when target element is not found',
  url: 'https://www.google.com',
  tool: 'action_agent',
  input: {
    objective: 'Click the "Sign Up" button',
    reasoning: 'Testing error handling when element does not exist',
    hint: 'There is no Sign Up button on Google homepage - agent should handle gracefully'
  },
  validation: {
    type: 'llm-judge',
    llmJudge: {
      criteria: [
        'Attempted to find the requested element',
        'Recognized that the element does not exist',
        'Provided clear error message or explanation',
        'Did not crash or produce confusing output',
        'Suggested alternatives or explained the issue'
      ],
      visualVerification: {
        enabled: true,
        captureBeforeAction: true,
        captureAfterAction: true,
        screenshotDelay: 2000,
        verificationPrompts: [
          'Verify the page remains in a stable state despite the missing element',
          'Confirm no error dialogs or broken UI elements appeared',
          'Check that the agent handled the missing element gracefully',
          'Ensure the page was properly analyzed even though the target was not found'
        ]
      }
    }
  },
  metadata: {
    tags: ['action', 'error-handling', 'missing-element', 'recovery', 'edge-case']
  }
};

// All action agent tests
export const actionAgentTests: TestCase<ActionAgentArgs>[] = [
  basicClickTest,
  formFillTest,
  navigationClickTest,
  ecommerceActionTest,
  checkboxActionTest,
  dropdownActionTest,
  multiStepFormTest,
  dynamicContentTest,
  loginFormTest,
  hoverActionTest,
  accessibilityActionTest,
  errorRecoveryTest
];

// Get basic tests for quick validation
export function getBasicActionTests(): TestCase<ActionAgentArgs>[] {
  return [
    basicClickTest,
    formFillTest,
    navigationClickTest
  ];
}

// Get tests by action type
export function getActionTestsByType(actionType: string): TestCase<ActionAgentArgs>[] {
  return actionAgentTests.filter(test => test.metadata.tags.includes(actionType));
}