// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import type {TSESTree} from '@typescript-eslint/utils';

import {createRule} from './utils/ruleCreator.ts';

function isWidgetShowCallWithDocumentBody(node: TSESTree.Node): node is TSESTree.CallExpression&{
  callee: TSESTree.MemberExpression&{
    object: TSESTree.Identifier,
    property: TSESTree.Identifier & {
      name: 'show',
    },
  },
      arguments: [TSESTree.MemberExpression&{
        object: TSESTree.Identifier & {name: 'document'},
        property: TSESTree.Identifier & {
          name: 'body',
        },
      }],
}
{
  return node.type === 'CallExpression' && node.callee.type === 'MemberExpression' &&
      node.callee.object.type === 'Identifier' && node.callee.property.type === 'Identifier' &&
      node.callee.property.name === 'show' && node.arguments.length === 1 &&
      node.arguments[0].type === 'MemberExpression' && node.arguments[0].object.type === 'Identifier' &&
      node.arguments[0].object.name === 'document' && node.arguments[0].property.type === 'Identifier' &&
      node.arguments[0].property.name === 'body';
}

export default createRule({
  name: 'no-widget-show-document-body',
  meta: {
    type: 'problem',

    docs: {
      description: 'Disallow usage of widget.show(document.body) in unit tests.',
      category: 'Possible Errors',
    },
    messages: {
      invalidShowUsage: 'Avoid mounting widgets into document.body in tests. Prefer the `renderElementIntoDOM` helper.',
    },
    fixable: 'code',
    schema: [],  // no options
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (!isWidgetShowCallWithDocumentBody(node)) {
          return;
        }
        context.report({
          node,
          messageId: 'invalidShowUsage',
          fix(fixer) {
            return fixer.replaceText(node, `renderElementIntoDOM(${node.callee.object.name})`);
          }
        });
      },
    };
  },
});
