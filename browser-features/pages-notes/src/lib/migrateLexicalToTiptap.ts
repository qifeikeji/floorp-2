import type { JSONContent } from "@tiptap/react";

/**
 * Converts Lexical editor JSON to TipTap/ProseMirror JSON format.
 * Handles three content types: Lexical JSON, TipTap JSON (passthrough), and plain text.
 */

// Lexical text format bitmask
const BOLD = 1;
const ITALIC = 2;
const STRIKETHROUGH = 4;
const UNDERLINE = 8;

interface LexicalTextNode {
    type: "text";
    text: string;
    format: number;
    [key: string]: unknown;
}

interface LexicalElementNode {
    type: string;
    children?: LexicalNode[];
    tag?: string;
    listType?: string;
    format?: string | number;
    [key: string]: unknown;
}

type LexicalNode = LexicalTextNode | LexicalElementNode;

interface LexicalRoot {
    root: {
        children: LexicalNode[];
        [key: string]: unknown;
    };
}

function formatToMarks(format: number): JSONContent["marks"] {
    const marks: NonNullable<JSONContent["marks"]> = [];
    if (format & BOLD) marks.push({ type: "bold" });
    if (format & ITALIC) marks.push({ type: "italic" });
    if (format & STRIKETHROUGH) marks.push({ type: "strike" });
    if (format & UNDERLINE) marks.push({ type: "underline" });
    return marks.length > 0 ? marks : undefined;
}

function convertTextNode(node: LexicalTextNode): JSONContent {
    const result: JSONContent = { type: "text", text: node.text };
    const marks = formatToMarks(node.format || 0);
    if (marks) result.marks = marks;
    return result;
}

function getTextAlignAttrs(format: string | number | undefined): Record<string, string> | undefined {
    if (typeof format === "string" && ["left", "center", "right"].includes(format)) {
        return { textAlign: format };
    }
    return undefined;
}

function convertChildren(children: LexicalNode[] | undefined): JSONContent[] | undefined {
    if (!children || children.length === 0) return undefined;
    const result = children.flatMap(convertNode);
    return result.length > 0 ? result : undefined;
}

function convertNode(node: LexicalNode): JSONContent[] {
    if (node.type === "text") {
        const textNode = node as LexicalTextNode;
        if (!textNode.text) return [];
        return [convertTextNode(textNode)];
    }

    if (node.type === "linebreak") {
        return [{ type: "hardBreak" }];
    }

    const elementNode = node as LexicalElementNode;

    switch (elementNode.type) {
        case "paragraph": {
            const attrs = getTextAlignAttrs(elementNode.format);
            const result: JSONContent = { type: "paragraph" };
            if (attrs) result.attrs = attrs;
            const content = convertChildren(elementNode.children);
            if (content) result.content = content;
            return [result];
        }

        case "heading": {
            const tag = elementNode.tag || "h1";
            const level = Number.parseInt(tag.replace("h", ""), 10);
            const attrs: Record<string, unknown> = { level };
            const textAlign = getTextAlignAttrs(elementNode.format);
            if (textAlign) Object.assign(attrs, textAlign);
            const result: JSONContent = { type: "heading", attrs };
            const content = convertChildren(elementNode.children);
            if (content) result.content = content;
            return [result];
        }

        case "list": {
            const listType = elementNode.listType === "number" ? "orderedList" : "bulletList";
            const result: JSONContent = { type: listType };
            const content = convertChildren(elementNode.children);
            if (content) result.content = content;
            return [result];
        }

        case "listitem": {
            // TipTap requires listItem > paragraph wrapping
            const innerContent = convertChildren(elementNode.children);
            const paragraph: JSONContent = { type: "paragraph" };
            if (innerContent) paragraph.content = innerContent;
            return [{ type: "listItem", content: [paragraph] }];
        }

        case "quote": {
            const result: JSONContent = { type: "blockquote" };
            const content = convertChildren(elementNode.children);
            if (content) result.content = content;
            return [result];
        }

        default: {
            // Unknown node type — treat as paragraph
            const result: JSONContent = { type: "paragraph" };
            const content = convertChildren(elementNode.children);
            if (content) result.content = content;
            return [result];
        }
    }
}

function convertLexicalToTiptap(lexical: LexicalRoot): JSONContent {
    const children = lexical.root.children;
    if (!Array.isArray(children)) {
        return { type: "doc", content: [{ type: "paragraph" }] };
    }
    const content = children.flatMap(convertNode);
    return {
        type: "doc",
        content: content.length > 0 ? content : [{ type: "paragraph" }],
    };
}

function plainTextToTiptap(text: string): JSONContent {
    const lines = text.split("\n");
    const content: JSONContent[] = lines.map((line) => {
        if (line.length === 0) return { type: "paragraph" };
        return { type: "paragraph", content: [{ type: "text", text: line }] };
    });
    return { type: "doc", content };
}

/**
 * Detects content format and converts to TipTap JSON if needed.
 * - Lexical JSON (has `root.children`) → convert
 * - TipTap JSON (has `type: "doc"`) → passthrough
 * - Plain text / empty → convert or return undefined
 */
export function migrateLexicalContent(content: string | undefined): JSONContent | undefined {
    if (!content || content.trim().length === 0) {
        return undefined;
    }

    try {
        const parsed = JSON.parse(content);

        // Already TipTap format
        if (parsed.type === "doc") {
            return parsed as JSONContent;
        }

        // Lexical format
        if (parsed.root?.children) {
            return convertLexicalToTiptap(parsed as LexicalRoot);
        }

        // Unknown JSON — treat as plain text
        return plainTextToTiptap(String(content));
    } catch {
        // Not JSON — plain text
        return plainTextToTiptap(content);
    }
}
