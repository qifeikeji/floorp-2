/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Root Node creation for Turndown
 */

import collapseWhitespace from "./collapse-whitespace.ts";
import HTMLParser from "./html-parser.ts";
import { isBlock, isVoid } from "./utilities.ts";

interface TurndownOptions {
  preformattedCode: boolean;
}

let htmlParserInstance: HTMLParser | null = null;

function getHtmlParser(): HTMLParser {
  if (!htmlParserInstance) {
    htmlParserInstance = new HTMLParser();
  }
  return htmlParserInstance;
}

export default function RootNode(
  input: string | Element,
  options: TurndownOptions & { skipClone?: boolean },
): Element {
  let root: Element;

  if (typeof input === "string") {
    const doc = getHtmlParser().parseFromString(
      // DOM parsers arrange elements in the <head> and <body>.
      // Wrapping in a custom element ensures elements are reliably arranged in
      // a single element.
      '<x-turndown id="turndown-root">' + input + "</x-turndown>",
    ) as unknown as Document;

    root = doc.getElementById("turndown-root")!;
  } else {
    // When the caller already provides a cloned tree (e.g. DOMReadOperations.getText),
    // skip the clone to avoid duplicating the entire DOM tree.
    root = options.skipClone ? input : (input.cloneNode(true) as Element);
  }

  collapseWhitespace({
    element: root,
    isBlock: isBlock,
    isVoid: isVoid,
    isPre: options.preformattedCode ? isPreOrCode : null,
  });

  return root;
}

function isPreOrCode(node: Node): boolean {
  return node.nodeName === "PRE" || node.nodeName === "CODE";
}
