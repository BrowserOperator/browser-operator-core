// Copyright 2025 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Canonical XPath builder function for DOM element introspection.
 *
 * This function is meant to be:
 * 1. Embedded in CDP Runtime.callFunctionOn() calls
 * 2. Injected into the page context for XPath generation
 * 3. Used by both SDK Target and CDP Adapter code paths
 *
 * Algorithm:
 * - Walks from element up to document root
 * - Counts same-type/same-name siblings for ordinal indexing
 * - Builds XPath with tag names and [n] predicates
 * - Handles text nodes, comment nodes, and html root
 */
export const XPATH_BUILDER_FUNCTION_STRING = `
function getNodePath(el) {
  if (!el || (el.nodeType !== Node.ELEMENT_NODE && el.nodeType !== Node.TEXT_NODE)) {
    return "";
  }

  const parts = [];
  let current = el;

  while (current && (current.nodeType === Node.ELEMENT_NODE || current.nodeType === Node.TEXT_NODE)) {
    // Count ALL same-type siblings to determine if index is needed
    let sameTypeSiblingCount = 0;
    let currentIndex = 0;
    const siblings = current.parentElement
      ? Array.from(current.parentElement.childNodes)
      : [];

    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling.nodeType === current.nodeType && sibling.nodeName === current.nodeName) {
        sameTypeSiblingCount++;
        if (sibling.isSameNode(current)) {
          currentIndex = sameTypeSiblingCount;
        }
      }
    }

    if (!current || !current.parentNode) break;
    if (current.nodeName.toLowerCase() === "html") {
      parts.unshift("html");
      break;
    }

    if (current.nodeName !== "#text") {
      const tagName = current.nodeName.toLowerCase();
      // Only add index if there are multiple siblings of the same type
      const pathIndex = sameTypeSiblingCount > 1 ? \`[\${currentIndex}]\` : "";
      parts.unshift(\`\${tagName}\${pathIndex}\`);
    }

    current = current.parentElement;
  }

  return parts.length ? \`/\${parts.join("/")}\` : "";
}`;
