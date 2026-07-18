interface EditorNode {
    text?: string;
    children?: EditorNode[];
    content?: EditorNode[];
    [key: string]: unknown;
}

function extractTextFromNode(node: EditorNode): string {
    if (node.text !== undefined) {
        return node.text;
    }
    const children = node.children || node.content;
    if (!children) {
        return "";
    }
    return children.map(extractTextFromNode).join("");
}

/**
 * Extract plain text from a serialized editor content string (TipTap or Lexical JSON, or plain text).
 */
export function extractPlainText(content: string): string {
    try {
        const parsed = JSON.parse(content);
        // TipTap format
        if (parsed.type === "doc") {
            return extractTextFromNode(parsed);
        }
        // Lexical format (legacy)
        if (parsed.root) {
            return extractTextFromNode(parsed.root);
        }
        return String(parsed);
    } catch {
        return content;
    }
}
