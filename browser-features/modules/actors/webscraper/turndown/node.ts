/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Node wrapper for Turndown
 */

import {
  isBlock,
  isVoid,
  hasVoid,
  isMeaningfulWhenBlank,
  hasMeaningfulWhenBlank,
} from "./utilities";
import {
  generateFingerprint,
  type ElementFingerprint,
  type FingerprintTextCache,
} from "./fingerprint";

export interface ExtendedNode extends Node {
  isBlock: boolean;
  isCode: boolean;
  isBlank: boolean;
  flankingWhitespace: {
    leading: string;
    trailing: string;
  };
  /** Element fingerprint (only set for element nodes when fingerprints enabled) */
  fingerprint?: ElementFingerprint;
}

interface NodeTurndownOptions {
  preformattedCode: boolean;
  /** Enable fingerprint generation for elements */
  enableFingerprints?: boolean;
}

export default function wrapNode(
  node: Node,
  options: NodeTurndownOptions,
  textCache?: FingerprintTextCache,
): ExtendedNode {
  const extended = node as ExtendedNode;
  extended.isBlock = isBlock(node);
  const parentNode = node.parentNode as unknown as ExtendedNode | null;
  extended.isCode = node.nodeName === "CODE" || (parentNode?.isCode ?? false);
  extended.isBlank = isBlank(node);
  extended.flankingWhitespace = flankingWhitespace(node, options);

  // Generate fingerprint for block elements only (performance optimization)
  // Skip empty elements and elements inside table cells to reduce noise.
  if (options.enableFingerprints && node.nodeType === 1 && extended.isBlock) { // Node.ELEMENT_NODE
    const el = node as Element;
    const text = el.textContent?.trim();
    if (text && text.length > 0 && !isInsideTableCell(el)) {
      extended.fingerprint = generateFingerprint(el, {}, textCache);
    }
  }

  return extended;
}

/**
 * Returns true if the element is inside a table cell (<td> or <th>).
 * Table row-level fingerprints are preserved; only cell-interior ones are skipped.
 */
function isInsideTableCell(el: Element): boolean {
  let parent = el.parentElement;
  while (parent) {
    const tag = parent.nodeName;
    if (tag === "TD" || tag === "TH") return true;
    if (tag === "TABLE" || tag === "BODY") return false;
    parent = parent.parentElement;
  }
  return false;
}

function isBlank(node: Node): boolean {
  return (
    !isVoid(node) &&
    !isMeaningfulWhenBlank(node) &&
    /^\s*$/i.test(node.textContent || "") &&
    !hasVoid(node) &&
    !hasMeaningfulWhenBlank(node)
  );
}

interface EdgeWhitespace {
  leading: string;
  leadingAscii: string;
  leadingNonAscii: string;
  trailing: string;
  trailingNonAscii: string;
  trailingAscii: string;
}

function flankingWhitespace(
  node: Node,
  options: NodeTurndownOptions,
): { leading: string; trailing: string } {
  const extended = node as ExtendedNode;
  if (extended.isBlock || (options.preformattedCode && extended.isCode)) {
    return { leading: "", trailing: "" };
  }

  const edges = edgeWhitespace(node.textContent || "");

  // abandon leading ASCII WS if left-flanked by ASCII WS
  if (
    edges.leadingAscii &&
    isFlankedByWhitespace("left", node, options)
  ) {
    edges.leading = edges.leadingNonAscii;
  }

  // abandon trailing ASCII WS if right-flanked by ASCII WS
  if (
    edges.trailingAscii &&
    isFlankedByWhitespace("right", node, options)
  ) {
    edges.trailing = edges.trailingNonAscii;
  }

  return { leading: edges.leading, trailing: edges.trailing };
}

function edgeWhitespace(string: string): EdgeWhitespace {
  const m = string.match(
    /^(([ \t\r\n]*)(\s*))(?:(?=\S)[\s\S]*\S)?((\s*?)([ \t\r\n]*))$/,
  );
  if (!m) {
    return {
      leading: "",
      leadingAscii: "",
      leadingNonAscii: "",
      trailing: "",
      trailingNonAscii: "",
      trailingAscii: "",
    };
  }
  return {
    leading: m[1], // whole string for whitespace-only strings
    leadingAscii: m[2],
    leadingNonAscii: m[3],
    trailing: m[4], // empty for whitespace-only strings
    trailingNonAscii: m[5],
    trailingAscii: m[6],
  };
}

function isFlankedByWhitespace(
  side: "left" | "right",
  node: Node,
  options: NodeTurndownOptions,
): boolean {
  let sibling: Node | null;
  let regExp: RegExp;
  let isFlanked = false;

  if (side === "left") {
    sibling = node.previousSibling;
    regExp = / $/;
  } else {
    sibling = node.nextSibling;
    regExp = /^ /;
  }

  if (sibling) {
    if (sibling.nodeType === 3) { // Node.TEXT_NODE
      isFlanked = regExp.test(sibling.textContent || "");
    } else if (options.preformattedCode && sibling.nodeName === "CODE") {
      isFlanked = false;
    } else if (
      sibling.nodeType === 1 && // Node.ELEMENT_NODE
      !(sibling as ExtendedNode).isBlock
    ) {
      isFlanked = regExp.test(sibling.textContent || "");
    }
  }
  return isFlanked;
}
