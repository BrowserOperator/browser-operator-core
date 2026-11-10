// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import {renderElementIntoDOM} from '../../../testing/DOMHelpers.js';
import {describeWithEnvironment} from '../../../testing/EnvironmentHelpers.js';

import './suggestion_input.js';

describeWithEnvironment('SuggestionInput security', () => {
  const EditableContent = customElements.get('devtools-editable-content') as CustomElementConstructor;
  it('keeps HTML-like editable text inert when focused', () => {
    const input = new EditableContent();
    const text = '<b class="untrusted-markup">literal text</b>&lt;script&gt;';
    input.textContent = text;
    renderElementIntoDOM(input);

    input.focus();

    assert.strictEqual(input.textContent, text);
    assert.strictEqual(input.childElementCount, 0);
  });

  it('preserves ordinary text when focused', () => {
    const input = new EditableContent();
    input.textContent = 'one & two < three';
    renderElementIntoDOM(input);

    input.focus();

    assert.strictEqual(input.textContent, 'one & two < three');
    assert.strictEqual(input.childElementCount, 0);
  });
});
