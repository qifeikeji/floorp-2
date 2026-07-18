/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * CommonMark-compatible HTML to Markdown rules
 * Based on https://github.com/mixmark-io/turndown
 * Copyright (c) 2014 Dom Christie
 * Released under the MIT License
 */

import { repeat } from "./utilities";
import type { Rule, TurndownOptions } from "./rules";
import type { ExtendedNode } from "./node";

const rules: Record<string, Rule> = {};

rules.paragraph = {
  filter: "p",

  replacement: function (content: string): string {
    return "\n\n" + content + "\n\n";
  },
};

rules.lineBreak = {
  filter: "br",

  replacement: function (_content: string, _node: ExtendedNode, options: TurndownOptions): string {
    return options.br + "\n";
  },
};

rules.heading = {
  filter: ["h1", "h2", "h3", "h4", "h5", "h6"],

  replacement: function (content: string, node: ExtendedNode, options: TurndownOptions): string {
    const hLevel = Number(node.nodeName.charAt(1));

    if (options.headingStyle === "setext" && hLevel < 3) {
      const underline = repeat(hLevel === 1 ? "=" : "-", content.length);
      return "\n\n" + content + "\n" + underline + "\n\n";
    } else {
      return "\n\n" + repeat("#", hLevel) + " " + content + "\n\n";
    }
  },
};

rules.blockquote = {
  filter: "blockquote",

  replacement: function (content: string): string {
    content = content.replace(/^\n+|\n+$/g, "");
    content = content.replace(/^/gm, "> ");
    return "\n\n" + content + "\n\n";
  },
};

rules.list = {
  filter: ["ul", "ol"],

  replacement: function (content: string, node: ExtendedNode): string {
    const parent = node.parentNode as unknown as Element;
    if (parent.nodeName === "LI" && parent.lastElementChild === (node as unknown as Element)) {
      return "\n" + content;
    } else {
      return "\n\n" + content + "\n\n";
    }
  },
};

rules.listItem = {
  filter: "li",

  replacement: function (content: string, node: ExtendedNode, options: TurndownOptions): string {
    let prefix = options.bulletListMarker + "   ";
    const parent = node.parentNode as unknown as Element;
    if (parent.nodeName === "OL") {
      const start = parent.getAttribute("start");
      const index = Array.prototype.indexOf.call(parent.children, node as unknown as Element);
      prefix = (start ? Number(start) + index : index + 1) + ".  ";
    }
    content = content
      .replace(/^\n+/, "") // remove leading newlines
      .replace(/\n+$/, "\n") // replace trailing newlines with just a single one
      .replace(/\n/gm, "\n" + " ".repeat(prefix.length)); // indent
    return (
      prefix +
      content +
      (node.nextSibling && !content.endsWith("\n") ? "\n" : "")
    );
  },
};

rules.indentedCodeBlock = {
  filter: function (node: ExtendedNode, options?: TurndownOptions): boolean {
    if (!options) return false;
    return (
      options.codeBlockStyle === "indented" &&
      node.nodeName === "PRE" &&
      node.firstChild !== null &&
      node.firstChild.nodeName === "CODE"
    );
  },

  replacement: function (_content: string, node: ExtendedNode): string {
    return (
      "\n\n    " +
      (node.firstChild?.textContent || "").replace(/\n/g, "\n    ") +
      "\n\n"
    );
  },
};

rules.fencedCodeBlock = {
  filter: function (node: ExtendedNode, options?: TurndownOptions): boolean {
    if (!options) return false;
    return (
      options.codeBlockStyle === "fenced" &&
      node.nodeName === "PRE" &&
      node.firstChild !== null &&
      node.firstChild.nodeName === "CODE"
    );
  },

  replacement: function (_content: string, node: ExtendedNode, options: TurndownOptions): string {
    const className = (node.firstChild as Element)?.getAttribute("class") || "";
    const language = (className.match(/language-(\S+)/) || [null, ""])[1];
    const code = (node.firstChild as Element)?.textContent || "";

    const fenceChar = options.fence.charAt(0);
    let fenceSize = 3;
    const fenceInCodeRegex = new RegExp("^" + fenceChar + "{3,}", "gm");

    let match: RegExpExecArray | null;
    while ((match = fenceInCodeRegex.exec(code)) !== null) {
      if (match[0].length >= fenceSize) {
        fenceSize = match[0].length + 1;
      }
    }

    const fence = repeat(fenceChar, fenceSize);

    return (
      "\n\n" +
      fence +
      language +
      "\n" +
      code.replace(/\n$/, "") +
      "\n" +
      fence +
      "\n\n"
    );
  },
};

rules.horizontalRule = {
  filter: "hr",

  replacement: function (_content: string, _node: ExtendedNode, options: TurndownOptions): string {
    return "\n\n" + options.hr + "\n\n";
  },
};

rules.inlineLink = {
  filter: function (node: ExtendedNode, options?: TurndownOptions): boolean {
    if (!options) return false;
    return (
      options.linkStyle === "inlined" &&
      node.nodeName === "A" &&
      ((node as unknown as Element).getAttribute("href") !== null)
    );
  },

  replacement: function (content: string, node: ExtendedNode): string {
    const elem = node as unknown as Element;
    const href = elem.getAttribute("href") || "";
    const cleanedHref = href.replace(/([()])/g, "\\$1");
    const titleAttr = cleanAttribute(elem.getAttribute("title"));
    const title = titleAttr ? ' "' + titleAttr.replace(/"/g, '\\"') + '"' : "";
    return "[" + content + "](" + cleanedHref + title + ")";
  },
};

rules.referenceLink = {
  filter: function (node: ExtendedNode, options?: TurndownOptions): boolean {
    if (!options) return false;
    return (
      options.linkStyle === "referenced" &&
      node.nodeName === "A" &&
      ((node as unknown as Element).getAttribute("href") !== null)
    );
  },

  replacement: function (
    content: string,
    node: ExtendedNode,
    options: TurndownOptions,
  ): string {
    const elem = node as unknown as Element;
    const href = elem.getAttribute("href") || "";
    const titleAttr = cleanAttribute(elem.getAttribute("title"));
    const title = titleAttr ? ' "' + titleAttr + '"' : "";
    let replacement: string;
    let reference: string;

    // Store references on the rule object itself (a bit hacky but follows original)
    const refs = (this as unknown as { references: string[] }).references || [];

    switch (options.linkReferenceStyle) {
      case "collapsed":
        replacement = "[" + content + "][]";
        reference = "[" + content + "]: " + href + title;
        break;
      case "shortcut":
        replacement = "[" + content + "]";
        reference = "[" + content + "]: " + href + title;
        break;
      default: {
        const id = refs.length + 1;
        replacement = "[" + content + "][" + id + "]";
        reference = "[" + id + "]: " + href + title;
        break;
      }
    }

    refs.push(reference);
    (this as unknown as { references: string[] }).references = refs;

    return replacement;
  },

  references: [] as string[],

  append: function (_options: TurndownOptions): string {
    const refs = (this as unknown as { references: string[] }).references || [];
    let references = "";
    if (refs.length > 0) {
      references = "\n\n" + refs.join("\n") + "\n\n";
      (this as unknown as { references: string[] }).references = []; // Reset references
    }
    return references;
  },
};

rules.emphasis = {
  filter: ["em", "i"],

  replacement: function (content: string, _node: ExtendedNode, options: TurndownOptions): string {
    if (!content.trim()) {
      return "";
    }
    return options.emDelimiter + content + options.emDelimiter;
  },
};

rules.strong = {
  filter: ["strong", "b"],

  replacement: function (content: string, _node: ExtendedNode, options: TurndownOptions): string {
    if (!content.trim()) {
      return "";
    }
    return options.strongDelimiter + content + options.strongDelimiter;
  },
};

rules.code = {
  filter: function (node: ExtendedNode): boolean {
    const hasSiblings = node.previousSibling || node.nextSibling;
    const parent = node.parentNode as Element;
    const isCodeBlock = parent.nodeName === "PRE" && !hasSiblings;

    return node.nodeName === "CODE" && !isCodeBlock;
  },

  replacement: function (content: string): string {
    if (!content) {
      return "";
    }
    content = content.replace(/\r?\n|\r/g, " ");

    const extraSpace = /^`|^ .*?[^ ].* $|`$/.test(content) ? " " : "";
    let delimiter = "`";
    const matches = content.match(/`+/gm);
    const matchArray: string[] = matches ? Array.from(matches) : [];
    while (matchArray.indexOf(delimiter) !== -1) {
      delimiter = delimiter + "`";
    }

    return delimiter + extraSpace + content + extraSpace + delimiter;
  },
};

rules.image = {
  filter: "img",

  replacement: function (_content: string, node: ExtendedNode): string {
    const elem = node as unknown as Element;
    const alt = cleanAttribute(elem.getAttribute("alt"));
    const src = elem.getAttribute("src") || "";
    const titleAttr = cleanAttribute(elem.getAttribute("title"));
    const titlePart = titleAttr ? ' "' + titleAttr + '"' : "";
    return src ? "![" + alt + "]" + "(" + src + titlePart + ")" : "";
  },
};

// =============================================================================
// Table rules
// =============================================================================

rules.tableCell = {
  filter: ["th", "td"],
  replacement: function (content: string, node: ExtendedNode): string {
    return tableCell(content, node);
  },
};

rules.tableRow = {
  filter: "tr",
  replacement: function (content: string, node: ExtendedNode): string {
    let borderCells = "";
    const elem = node as unknown as Element;

    if (isHeadingRow(elem)) {
      const columns = elem.children;
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i] as HTMLElement;
        const inlineAlign = col.getAttribute("style")?.match(/text-align\s*:\s*(\w+)/i)?.[1];
        const align = inlineAlign || col.getAttribute("align");
        let border = "---";
        if (align === "center") border = ":---:";
        else if (align === "right") border = "---:";
        else if (align === "left") border = ":---";
        borderCells += tableCell(border, columns[i] as unknown as ExtendedNode);
      }
    }

    return "\n" + content + (borderCells ? "\n" + borderCells : "");
  },
};

rules.table = {
  filter: "table",
  replacement: function (content: string): string {
    content = content.replace(/\n+/g, "\n");
    return "\n\n" + content + "\n\n";
  },
};

rules.tableSection = {
  filter: ["thead", "tbody", "tfoot"],
  replacement: function (content: string): string {
    return content;
  },
};

function tableCell(content: string, node: ExtendedNode): string {
  const parent = node.parentNode as Element;
  const index = Array.prototype.indexOf.call(
    parent.children,
    node as unknown as Element,
  );
  let prefix = " ";
  if (index === 0) prefix = "| ";
  const cleaned = content.replace(/\n/g, " ").trim();
  return prefix + cleaned + " |";
}

function isHeadingRow(tr: Element): boolean {
  const parent = tr.parentNode as Element;
  if (parent.nodeName === "THEAD") return true;
  if (parent.nodeName === "TABLE" || parent.nodeName === "TBODY") {
    const rows = parent.querySelectorAll("tr");
    if (rows[0] === tr) {
      return Array.from(tr.children).every((c) => c.nodeName === "TH");
    }
  }
  return false;
}

// =============================================================================
// Strikethrough rule
// =============================================================================

rules.strikethrough = {
  filter: ["del", "s", "strike"],
  replacement: function (content: string): string {
    if (!content.trim()) return "";
    return "~~" + content + "~~";
  },
};

// =============================================================================
// Form element rules
// =============================================================================

rules.input = {
  filter: function (node: ExtendedNode): boolean {
    return (
      node.nodeName === "INPUT" &&
      !["hidden", "submit", "button", "reset", "image"].includes(
        ((node as unknown as HTMLInputElement).type || "").toLowerCase(),
      )
    );
  },
  replacement: function (_content: string, node: ExtendedNode): string {
    const el = node as unknown as HTMLInputElement;
    const type = (el.type || "text").toLowerCase();
    const name = el.name || el.id || "";
    const value = el.value || "";
    const placeholder = el.placeholder || "";

    if (type === "checkbox" || type === "radio") {
      return `[${el.checked ? "x" : " "}] `;
    }

    const attrs = [
      `type="${type}"`,
      name && `name="${name}"`,
      value && `value="${value}"`,
      placeholder && `placeholder="${placeholder}"`,
      el.disabled ? "disabled" : "",
      el.required ? "required" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return `\`<input ${attrs}>\``;
  },
};

rules.select = {
  filter: "select",
  replacement: function (_content: string, node: ExtendedNode): string {
    const el = node as unknown as HTMLSelectElement;
    const name = el.name || el.id || "";
    const options = (Array.from(el.options) as HTMLOptionElement[]).map((opt) => {
      const selected = opt.selected ? "*" : "";
      return `${selected}${opt.textContent?.trim() || opt.value}`;
    });
    const optionsList = options.slice(0, 10).join(", ");
    const more =
      el.options.length > 10 ? ` (+${el.options.length - 10} more)` : "";
    return `\`<select name="${name}" options=[${optionsList}${more}]>\``;
  },
};

rules.textarea = {
  filter: "textarea",
  replacement: function (_content: string, node: ExtendedNode): string {
    const el = node as unknown as HTMLTextAreaElement;
    const name = el.name || el.id || "";
    const value = (el.value || "").slice(0, 100);
    const placeholder = el.placeholder || "";
    return `\`<textarea name="${name}" placeholder="${placeholder}">${value}</textarea>\``;
  },
};

// =============================================================================

function cleanAttribute(attribute: string | null): string {
  return attribute ? attribute.replace(/(\n+\s*)+/g, "\n") : "";
}

export default rules;
