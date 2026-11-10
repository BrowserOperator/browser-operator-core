// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as Common from '../../../../core/common/common.js';
import * as Platform from '../../../../core/platform/platform.js';
import * as TextUtils from '../../../../models/text_utils/text_utils.js';
import {renderElementIntoDOM} from '../../../../testing/DOMHelpers.js';
import {describeWithEnvironment} from '../../../../testing/EnvironmentHelpers.js';

import * as SourceFrame from './source_frame.js';

const {urlString} = Platform.DevToolsPath;

describeWithEnvironment('FontView security', () => {
  async function fontRules(content: TextUtils.ContentData.ContentDataOrError, url: Platform.DevToolsPath.UrlString) {
    const loaded = Promise.resolve(content);
    const provider = new TextUtils.StaticContentProvider.StaticContentProvider(
        url, Common.ResourceType.resourceTypes.Font, () => loaded);
    const view = new SourceFrame.FontView.FontView('font/woff2', provider);
    renderElementIntoDOM(view);
    // The view registers its content callback before this await continuation.
    await loaded;
    const sheet = view.fontStyleElement?.sheet;
    assert.instanceOf(sheet, CSSStyleSheet);
    return (sheet as CSSStyleSheet).cssRules;
  }

  it('keeps a malicious charset inside the font URL', async () => {
    // Adapted from upstream c98961307b92b731acef5fee919d915eef4086d8.
    const charset = 'utf-8); } * { background-color: rgb(255, 0, 0) !important; } /*';
    const content = new TextUtils.ContentData.ContentData('YmFzZTY0', true, 'text/plain', charset);
    const rules = await fontRules(content, urlString`https://example.com/font.woff2`);
    assert.lengthOf(rules, 1);
    assert.strictEqual(rules[0].type, CSSRule.FONT_FACE_RULE);
    assert.isNotEmpty((rules[0] as CSSFontFaceRule).style.getPropertyValue('src'));
  });

  it('escapes a fallback URL when font content cannot be loaded', async () => {
    const url = urlString`data:font/woff2;charset=utf-8); } * { color: red; } /*;base64,YmFzZTY0`;
    const rules = await fontRules({error: 'Font content unavailable'}, url);
    assert.lengthOf(rules, 1);
    assert.strictEqual(rules[0].type, CSSRule.FONT_FACE_RULE);
    assert.isNotEmpty((rules[0] as CSSFontFaceRule).style.getPropertyValue('src'));
  });

  it('quotes literal quotes and backslashes in a fallback URL', async () => {
    const url = urlString`https://example.com/font.woff2?value="; } * { color: red; } /*&slash=\\tail`;
    const rules = await fontRules({error: 'Font content unavailable'}, url);
    assert.lengthOf(rules, 1);
    assert.strictEqual(rules[0].type, CSSRule.FONT_FACE_RULE);
    const src = (rules[0] as CSSFontFaceRule).style.getPropertyValue('src');
    assert.include(src, String.raw`\"; } * { color: red; } /*`);
    assert.include(src, String.raw`\\tail`);
  });

  it('retains a normal font preview rule', async () => {
    const content = new TextUtils.ContentData.ContentData('YmFzZTY0', true, 'font/woff2');
    const rules = await fontRules(content, urlString`https://example.com/font.woff2`);
    assert.lengthOf(rules, 1);
    assert.strictEqual(rules[0].type, CSSRule.FONT_FACE_RULE);
    assert.isNotEmpty((rules[0] as CSSFontFaceRule).style.getPropertyValue('src'));
  });
});
