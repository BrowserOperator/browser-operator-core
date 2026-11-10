// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import '../ModelSelector.js';
import {raf} from '../../../../../testing/DOMHelpers.js';
import type {ModelSelector, ModelOption} from '../ModelSelector.js';

describe('ModelSelector Component', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function createSelector(options?: {
    options?: ModelOption[];
    selected?: string;
    disabled?: boolean;
    preferAbove?: boolean;
    forceSearchable?: boolean;
  }): ModelSelector {
    const selector = document.createElement('ai-model-selector') as ModelSelector;
    if (options?.options !== undefined) {
      selector.options = options.options;
    }
    if (options?.selected !== undefined) {
      selector.selected = options.selected;
    }
    if (options?.disabled !== undefined) {
      selector.disabled = options.disabled;
    }
    if (options?.preferAbove !== undefined) {
      selector.preferAbove = options.preferAbove;
    }
    if (options?.forceSearchable !== undefined) {
      selector.forceSearchable = options.forceSearchable;
    }
    container.appendChild(selector);
    return selector;
  }

  function getSmallOptions(): ModelOption[] {
    return [
      { value: 'gpt-4', label: 'GPT-4' },
      { value: 'gpt-3.5', label: 'GPT-3.5' },
      { value: 'claude-3', label: 'Claude 3' },
    ];
  }

  function getManyOptions(): ModelOption[] {
    return Array.from({ length: 25 }, (_, i) => ({
      value: `model-${i}`,
      label: `Model ${i}`,
    }));
  }

  describe('Basic Rendering (Native Select)', () => {
    it('renders dropdown with options', async () => {
      const selector = createSelector({
        options: getSmallOptions(),
        selected: 'gpt-4',
      });
      await raf();

      const select = selector.querySelector('select.model-select');
      assert.isNotNull(select, 'Should render native select for few options');

      const optionEls = select!.querySelectorAll('option');
      assert.strictEqual(optionEls.length, 3);
    });

    it('selects the correct option', async () => {
      const selector = createSelector({
        options: getSmallOptions(),
        selected: 'gpt-3.5',
      });
      await raf();

      const select = selector.querySelector('select.model-select') as HTMLSelectElement;
      assert.strictEqual(select.value, 'gpt-3.5');
    });

    it('handles option selection', async () => {
      const selector = createSelector({
        options: getSmallOptions(),
        selected: 'gpt-4',
      });
      await raf();

      let changedValue = '';
      selector.addEventListener('change', (e: Event) => {
        changedValue = (e as CustomEvent).detail.value;
      });

      const select = selector.querySelector('select.model-select') as HTMLSelectElement;
      select.value = 'claude-3';
      select.dispatchEvent(new Event('change', { bubbles: true }));

      assert.strictEqual(changedValue, 'claude-3');
    });

    it('renders disabled state', async () => {
      const selector = createSelector({
        options: getSmallOptions(),
        selected: 'gpt-4',
        disabled: true,
      });
      await raf();

      const select = selector.querySelector('select.model-select') as HTMLSelectElement;
      assert.isTrue(select.disabled);
    });
  });

  describe('Searchable Mode (20+ options)', () => {
    it('shows search when 20+ options', async () => {
      const selector = createSelector({
        options: getManyOptions(),
        selected: 'model-0',
      });
      await raf();

      const selectorDiv = selector.querySelector('.model-selector.searchable');
      assert.isNotNull(selectorDiv, 'Should use searchable mode for 20+ options');

      const trigger = selector.querySelector('.model-select-trigger');
      assert.isNotNull(trigger);
    });

    it('shows search when forceSearchable is true', async () => {
      const selector = createSelector({
        options: getSmallOptions(),
        selected: 'gpt-4',
        forceSearchable: true,
      });
      await raf();

      const selectorDiv = selector.querySelector('.model-selector.searchable');
      assert.isNotNull(selectorDiv);
    });

    it('opens dropdown on trigger click', async () => {
      const selector = createSelector({
        options: getManyOptions(),
        selected: 'model-0',
      });
      await raf();

      const trigger = selector.querySelector('.model-select-trigger') as HTMLButtonElement;
      trigger.click();
      await raf();

      const dropdown = selector.querySelector('.model-dropdown');
      assert.isNotNull(dropdown, 'Dropdown should be visible after click');

      const searchInput = selector.querySelector('.model-search');
      assert.isNotNull(searchInput, 'Should have search input');
    });

    it('displays selected model label in trigger', async () => {
      const selector = createSelector({
        options: getManyOptions(),
        selected: 'model-5',
      });
      await raf();

      const selectedLabel = selector.querySelector('.selected-model');
      assert.isNotNull(selectedLabel);
      assert.include(selectedLabel!.textContent, 'Model 5');
    });
  });

  describe('Keyboard Navigation', () => {
    it('navigates with ArrowDown', async () => {
      const selector = createSelector({
        options: getManyOptions(),
        selected: 'model-0',
      });
      await raf();

      // Open dropdown
      const trigger = selector.querySelector('.model-select-trigger') as HTMLButtonElement;
      trigger.click();
      await raf();

      const searchInput = selector.querySelector('.model-search') as HTMLInputElement;
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await raf();

      const highlighted = selector.querySelector('.model-option.highlighted');
      assert.isNotNull(highlighted);
      assert.include(highlighted!.textContent, 'Model 1');
    });

    it('navigates with ArrowUp', async () => {
      const selector = createSelector({
        options: getManyOptions(),
        selected: 'model-0',
      });
      await raf();

      // Open dropdown
      const trigger = selector.querySelector('.model-select-trigger') as HTMLButtonElement;
      trigger.click();
      await raf();

      const searchInput = selector.querySelector('.model-search') as HTMLInputElement;

      // Move down twice then up once
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await raf();
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await raf();
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      await raf();

      const highlighted = selector.querySelector('.model-option.highlighted');
      assert.isNotNull(highlighted);
      assert.include(highlighted!.textContent, 'Model 1');
    });

    it('selects on Enter', async () => {
      const selector = createSelector({
        options: getManyOptions(),
        selected: 'model-0',
      });
      await raf();

      let changedValue = '';
      selector.addEventListener('change', (e: Event) => {
        changedValue = (e as CustomEvent).detail.value;
      });

      // Open dropdown
      const trigger = selector.querySelector('.model-select-trigger') as HTMLButtonElement;
      trigger.click();
      await raf();

      const searchInput = selector.querySelector('.model-search') as HTMLInputElement;

      // Move to second option and select
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await raf();
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await raf();

      assert.strictEqual(changedValue, 'model-1');
    });

    it('closes on Escape', async () => {
      const selector = createSelector({
        options: getManyOptions(),
        selected: 'model-0',
      });
      await raf();

      // Open dropdown
      const trigger = selector.querySelector('.model-select-trigger') as HTMLButtonElement;
      trigger.click();
      await raf();

      let dropdown = selector.querySelector('.model-dropdown');
      assert.isNotNull(dropdown);

      const searchInput = selector.querySelector('.model-search') as HTMLInputElement;
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await raf();

      dropdown = selector.querySelector('.model-dropdown');
      assert.isNull(dropdown, 'Dropdown should close on Escape');
    });
  });

  describe('Search Filtering', () => {
    it('filters options by search query', async () => {
      const options: ModelOption[] = [
        { value: 'gpt-4', label: 'GPT-4' },
        { value: 'gpt-3.5', label: 'GPT-3.5' },
        { value: 'claude-3', label: 'Claude 3' },
        ...Array.from({ length: 20 }, (_, i) => ({
          value: `other-${i}`,
          label: `Other Model ${i}`,
        })),
      ];

      const selector = createSelector({
        options,
        selected: 'gpt-4',
      });
      await raf();

      // Open dropdown
      const trigger = selector.querySelector('.model-select-trigger') as HTMLButtonElement;
      trigger.click();
      await raf();

      const searchInput = selector.querySelector('.model-search') as HTMLInputElement;
      searchInput.value = 'gpt';
      searchInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await raf();

      const visibleOptions = selector.querySelectorAll('.model-option:not(.no-results)');
      assert.strictEqual(visibleOptions.length, 2, 'Should only show GPT models');
    });

    it('shows no results message when no matches', async () => {
      const selector = createSelector({
        options: getManyOptions(),
        selected: 'model-0',
      });
      await raf();

      // Open dropdown
      const trigger = selector.querySelector('.model-select-trigger') as HTMLButtonElement;
      trigger.click();
      await raf();

      const searchInput = selector.querySelector('.model-search') as HTMLInputElement;
      searchInput.value = 'zzzzz-no-match';
      searchInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await raf();

      const noResults = selector.querySelector('.model-option.no-results');
      assert.isNotNull(noResults);
      assert.include(noResults!.textContent, 'No matching models found');
    });

    it('filters by value as well as label', async () => {
      const options: ModelOption[] = [
        { value: 'anthropic/claude-3', label: 'Claude 3 Opus' },
        ...Array.from({ length: 20 }, (_, i) => ({
          value: `model-${i}`,
          label: `Model ${i}`,
        })),
      ];

      const selector = createSelector({
        options,
        selected: 'anthropic/claude-3',
      });
      await raf();

      // Open dropdown
      const trigger = selector.querySelector('.model-select-trigger') as HTMLButtonElement;
      trigger.click();
      await raf();

      const searchInput = selector.querySelector('.model-search') as HTMLInputElement;
      searchInput.value = 'anthropic';
      searchInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
      await raf();

      const visibleOptions = selector.querySelectorAll('.model-option:not(.no-results)');
      assert.strictEqual(visibleOptions.length, 1);
    });
  });

  describe('Disabled State', () => {
    it('trigger button is disabled when disabled is true', async () => {
      const selector = createSelector({
        options: getManyOptions(),
        selected: 'model-0',
        disabled: true,
      });
      await raf();

      const trigger = selector.querySelector('.model-select-trigger') as HTMLButtonElement;
      assert.isTrue(trigger.disabled);
    });

    it('does not open dropdown when disabled', async () => {
      const selector = createSelector({
        options: getManyOptions(),
        selected: 'model-0',
        disabled: true,
      });
      await raf();

      const trigger = selector.querySelector('.model-select-trigger') as HTMLButtonElement;
      trigger.click();
      await raf();

      const dropdown = selector.querySelector('.model-dropdown');
      assert.isNull(dropdown, 'Should not open when disabled');
    });
  });

  describe('Position Preference', () => {
    it('applies above class when preferAbove is true', async () => {
      const selector = createSelector({
        options: getManyOptions(),
        selected: 'model-0',
        preferAbove: true,
      });
      await raf();

      // Open dropdown
      const trigger = selector.querySelector('.model-select-trigger') as HTMLButtonElement;
      trigger.click();
      await raf();

      const dropdown = selector.querySelector('.model-dropdown');
      assert.isNotNull(dropdown);
      assert.isTrue(dropdown!.classList.contains('above'));
    });

    it('applies below class when preferAbove is false', async () => {
      const selector = createSelector({
        options: getManyOptions(),
        selected: 'model-0',
        preferAbove: false,
      });
      await raf();

      // Open dropdown
      const trigger = selector.querySelector('.model-select-trigger') as HTMLButtonElement;
      trigger.click();
      await raf();

      const dropdown = selector.querySelector('.model-dropdown');
      assert.isNotNull(dropdown);
      assert.isTrue(dropdown!.classList.contains('below'));
    });
  });

  describe('Edge Cases', () => {
    it('handles empty options array', async () => {
      const selector = createSelector({
        options: [],
        selected: undefined,
      });
      await raf();

      // Should render without error
      const selectorDiv = selector.querySelector('.model-selector');
      assert.isNotNull(selectorDiv);
    });

    it('handles invalid selected value', async () => {
      const selector = createSelector({
        options: getSmallOptions(),
        selected: 'non-existent-model',
      });
      await raf();

      // Should show the invalid value or fallback
      const select = selector.querySelector('select.model-select') as HTMLSelectElement;
      // Value may be empty or first option depending on browser
      assert.isNotNull(select);
    });

    it('emits model-selector-focus on open', async () => {
      const selector = createSelector({
        options: getManyOptions(),
        selected: 'model-0',
      });
      await raf();

      let focusCalled = false;
      selector.addEventListener('model-selector-focus', () => {
        focusCalled = true;
      });

      const trigger = selector.querySelector('.model-select-trigger') as HTMLButtonElement;
      trigger.click();
      await raf();

      assert.isTrue(focusCalled);
    });

    it('emits model-selector-focus on native select focus', async () => {
      const selector = createSelector({
        options: getSmallOptions(),
        selected: 'gpt-4',
      });
      await raf();

      let focusCalled = false;
      selector.addEventListener('model-selector-focus', () => {
        focusCalled = true;
      });

      const select = selector.querySelector('select.model-select') as HTMLSelectElement;
      select.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

      assert.isTrue(focusCalled);
    });
  });

  describe('Mouse Interaction', () => {
    it('highlights option on mouse enter', async () => {
      const selector = createSelector({
        options: getManyOptions(),
        selected: 'model-0',
      });
      await raf();

      // Open dropdown
      const trigger = selector.querySelector('.model-select-trigger') as HTMLButtonElement;
      trigger.click();
      await raf();

      const options = selector.querySelectorAll('.model-option:not(.no-results)');
      const thirdOption = options[2] as HTMLElement;

      thirdOption.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await raf();

      assert.isTrue(thirdOption.classList.contains('highlighted'));
    });

    it('selects option on click', async () => {
      const selector = createSelector({
        options: getManyOptions(),
        selected: 'model-0',
      });
      await raf();

      let changedValue = '';
      selector.addEventListener('change', (e: Event) => {
        changedValue = (e as CustomEvent).detail.value;
      });

      // Open dropdown
      const trigger = selector.querySelector('.model-select-trigger') as HTMLButtonElement;
      trigger.click();
      await raf();

      const options = selector.querySelectorAll('.model-option:not(.no-results)');
      (options[3] as HTMLElement).click();
      await raf();

      assert.strictEqual(changedValue, 'model-3');
    });
  });
});
