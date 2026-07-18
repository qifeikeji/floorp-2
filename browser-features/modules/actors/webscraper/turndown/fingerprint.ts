/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Stable fingerprint generation for DOM elements
 *
 * Fingerprints are based on content and structure, not volatile attributes
 * like id/class/data-*. This allows element identification to survive
 * minor HTML attribute changes.
 */

/**
 * Element fingerprint containing short and full hash representations
 */
export interface ElementFingerprint {
  /** Short hash (8 chars) for embedding in markdown as HTML comment */
  short: string;
  /** Full hash (16 chars) for selector map entries */
  full: string;
  /** Structural path for debugging (e.g., "html/body/div[0]/p[1]") */
  path: string;
}

/**
 * Configuration for fingerprint generation
 */
export interface FingerprintOptions {
  /** Characters of text content to include in hash (default: 64) */
  textContentLength: number;
  /** Include sibling index in path (default: true) */
  includeSiblingIndex: boolean;
  /** Maximum depth to traverse for parent context (default: 3) */
  parentContextDepth: number;
  /** Attributes to exclude from fingerprinting (default: id, class, data-*, style) */
  excludedAttributes: string[];
}

const DEFAULT_OPTIONS: FingerprintOptions = {
  textContentLength: 64,
  includeSiblingIndex: true,
  parentContextDepth: 3,
  excludedAttributes: ["id", "class", "style", "data-*"],
};

/**
 * Tag names excluded from fingerprint computation (sibling index, text content,
 * child count). These elements are removed from the cloned DOM before Markdown
 * conversion (in DOMReadOperations.getText), so they must also be excluded when
 * computing fingerprints on the original DOM to ensure consistent results.
 */
const STRUCTURAL_EXCLUDED_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);

/**
 * CSS class prefix for elements injected by the highlight manager.
 * These overlays are added/removed dynamically during automation operations
 * and must be excluded from fingerprint computation to maintain consistency
 * between getText() output (cloned DOM without overlays) and
 * findElementByFingerprint() lookups (live DOM with potential overlays).
 */
const HIGHLIGHT_OVERLAY_CLASS_PREFIX = "nr-webscraper-";

/**
 * Check if an element is a highlight overlay injected by the automation system.
 */
function isHighlightOverlay(element: Element): boolean {
  const className = element.className;
  if (typeof className === "string" && className.startsWith(HIGHLIGHT_OVERLAY_CLASS_PREFIX)) {
    return true;
  }
  // Also check the element's id for the style element
  if (element.id === "nr-webscraper-highlight-style") {
    return true;
  }
  return false;
}

/**
 * Check if an element should be excluded from fingerprint computation.
 * Excludes both structural tags (script/style/noscript) and highlight overlays.
 */
function isExcludedElement(element: Element): boolean {
  return STRUCTURAL_EXCLUDED_TAGS.has(element.nodeName) || isHighlightOverlay(element);
}

/**
 * Simple non-cryptographic hash function (djb2 variant)
 * Fast and produces consistent results across runs
 *
 * @param str The string to hash
 * @param seed Initial hash value (use different seeds for independent hashes)
 */
function hashString(str: string, seed: number = 5381): number {
  let hash = seed;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
  }
  return hash >>> 0; // Convert to unsigned 32-bit integer
}

/**
 * Get text content of an element, excluding text from script/style/noscript
 * descendants. This matches the behavior of cloned DOMs where these elements
 * are removed before fingerprint generation.
 */
function getFilteredTextContent(element: Element): string {
  let text = "";
  const walker = element.ownerDocument!.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node: Node): number {
        // Walk up to check if any ancestor (up to our target element) is excluded
        let parent = node.parentElement;
        while (parent && parent !== element) {
          if (isExcludedElement(parent)) {
            return NodeFilter.FILTER_REJECT;
          }
          parent = parent.parentElement;
        }
        // Also reject if the direct parent is excluded
        if (node.parentElement && isExcludedElement(node.parentElement)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let node: Node | null;
  while ((node = walker.nextNode())) {
    text += node.textContent || "";
  }
  return text;
}

/**
 * Count child elements excluding script/style/noscript, matching the
 * cloned DOM structure used for Markdown conversion.
 */
function getFilteredChildCount(element: Element): number {
  let count = 0;
  for (let i = 0; i < element.children.length; i++) {
    if (!isExcludedElement(element.children[i])) {
      count++;
    }
  }
  return count;
}

/**
 * Convert hash to base36 string (alphanumeric, lowercase)
 */
function toBase36(hash: number): string {
  return hash.toString(36).toLowerCase();
}

/**
 * Check if an attribute name should be excluded from fingerprinting
 */
function isExcludedAttribute(attrName: string, excluded: string[]): boolean {
  // Check exact matches
  if (excluded.includes(attrName)) {
    return true;
  }
  // Check prefix matches (e.g., "data-*")
  for (const excludedAttr of excluded) {
    if (excludedAttr.endsWith("*") && attrName.startsWith(excludedAttr.slice(0, -1))) {
      return true;
    }
  }
  return false;
}

/**
 * Pre-computes filtered text content for all elements in a single
 * bottom-up pass.  Using this cache turns the per-element text
 * extraction inside `generateFingerprint()` from O(m) to O(1),
 * reducing the overall getText() cost from O(n×m) to O(n).
 */
export class FingerprintTextCache {
  private cache = new WeakMap<Element, string>();
  private computed = false;

  /**
   * Bottom-up single-pass computation of filtered text for every element
   * under `root`.  The root itself is included.
   *
   * Must be called on a clone that already had script/style/noscript removed,
   * or the exclusion filter handles it automatically.
   */
  precompute(root: Element): void {
    const elements: Element[] = [];
    const walker = root.ownerDocument!.createTreeWalker(
      root,
      NodeFilter.SHOW_ELEMENT,
    );
    let node: Node | null;
    while ((node = walker.nextNode())) {
      elements.push(node as Element);
    }

    // Leaf → root order so children are cached before parents
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (isExcludedElement(el)) {
        this.cache.set(el, "");
        continue;
      }
      let text = "";
      for (const child of el.childNodes) {
        if (!child) continue;
        if (child.nodeType === 3 /* TEXT_NODE */) {
          text += child.textContent || "";
        } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
          text += this.cache.get(child as Element) || "";
        }
      }
      this.cache.set(el, text);
    }
    this.computed = true;
  }

  /**
   * Retrieve pre-computed text for an element.
   * Falls back to the full TreeWalker approach if precompute() was not called
   * or the element is not in the cache (e.g., from a different DOM clone).
   */
  getTextContent(el: Element, maxLength: number): string {
    if (this.computed) {
      const cached = this.cache.get(el);
      if (cached !== undefined) {
        return cached.replace(/\s+/g, "").slice(0, maxLength);
      }
    }
    return getFilteredTextContent(el).replace(/\s+/g, "").slice(0, maxLength);
  }
}

/**
 * Generate a stable fingerprint for an element
 *
 * The fingerprint is based on:
 * - Tag name
 * - Text content (first N characters, normalized)
 * - Parent path (tag names + sibling indices)
 * - Child element count
 * - Attribute names (excluding id/class/style/data-*)
 *
 * @param element The DOM element to fingerprint
 * @param options Configuration options
 * @param textCache Optional pre-computed text cache for O(1) text lookups
 * @returns ElementFingerprint with short, full hash and path
 */
export function generateFingerprint(
  element: Element,
  options: Partial<FingerprintOptions> = {},
  textCache?: FingerprintTextCache,
): ElementFingerprint {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Collect fingerprint components
  const components: string[] = [];

  // 1. Tag name (always include)
  components.push(element.nodeName.toLowerCase());

  // 2. Text content (first N characters, normalized)
  // Use textCache (O(1)) if available, otherwise fall back to TreeWalker.
  const textContent = textCache
    ? textCache.getTextContent(element, opts.textContentLength)
    : getFilteredTextContent(element)
        .replace(/\s+/g, "")
        .slice(0, opts.textContentLength);
  if (textContent) {
    components.push(textContent);
  }

  // 3. Structural context (parent tags + sibling context)
  // Stop at <body> to ensure consistent paths between cloned DOMs
  // (where body has no parentElement) and the live document.
  const path: string[] = [];
  let current: Element | null = element;
  let depth = 0;

  while (current && depth < opts.parentContextDepth) {
    const tagName = current.nodeName.toLowerCase();
    // Stop traversal at body — going higher (html, document) would
    // produce different paths on cloned vs live DOMs
    if (tagName === "body") {
      break;
    }

    if (opts.includeSiblingIndex && current.parentElement && current.parentElement.children) {
      // Exclude script/style/noscript and highlight overlays from sibling
      // counting so fingerprints are consistent between the original DOM
      // and the clone used for Markdown conversion.
      const siblings = Array.from(current.parentElement.children)
        .filter((s) => !isExcludedElement(s));
      const index = siblings.indexOf(current);
      path.unshift(`${tagName}[${index}]`);
    } else {
      path.unshift(tagName);
    }

    current = current.parentElement;
    depth++;
  }

  components.push(path.join("/"));

  // 4. Child element count (structural signature)
  // Exclude script/style/noscript from count to match cloned DOM
  components.push(`children:${getFilteredChildCount(element)}`);

  // 5. Attribute names only (not values - those may change)
  const attrNames = Array.from(element.attributes)
    .map((a) => a.name)
    .filter((name) => !isExcludedAttribute(name, opts.excludedAttributes))
    .sort()
    .join(",");
  if (attrNames) {
    components.push(`attrs:${attrNames}`);
  }

  // Generate hashes using independent seeds for better collision resistance.
  // Different seeds produce truly independent hash values, unlike appending
  // a suffix which produces correlated outputs from the same hash function.
  const fingerprintString = components.join("|");
  const primaryHash = hashString(fingerprintString, 5381);
  const secondaryHash = hashString(fingerprintString, 33797);

  return {
    short: toBase36(primaryHash).slice(0, 8).padStart(8, "0"),
    full: (toBase36(primaryHash) + toBase36(secondaryHash)).slice(0, 16).padStart(16, "0"),
    path: path.join("/"),
  };
}

/**
 * Format fingerprint as HTML comment for embedding in markdown
 * @param fingerprint The fingerprint to format
 * @returns HTML comment string like "<!--fp:abc12345-->"
 */
export function formatFingerprintComment(fingerprint: ElementFingerprint): string {
  return `<!--fp:${fingerprint.short}-->`;
}

/**
 * Format fingerprint as selector map entry.
 * Uses `fp:` prefix to avoid conflict with Markdown link reference syntax.
 *
 * @param fingerprint The fingerprint to format
 * @param tagName The element's tag name
 * @param textPreview Text preview for the entry
 * @returns Selector map entry string like "fp:abc12345def67890 | p | \"Preview text\""
 */
export function formatSelectorMapEntry(
  fingerprint: ElementFingerprint,
  tagName: string,
  textPreview: string,
): string {
  // Truncate first to avoid splitting escape sequences at the boundary.
  // Then escape special characters to preserve the pipe-delimited format.
  const preview = textPreview
    .trim()
    .replace(/\r/g, "")
    .replace(/\n/g, " ")
    .slice(0, 50)
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/"/g, '\\"');
  return `fp:${fingerprint.full} | ${tagName} | "${preview}"`;
}

/**
 * Parsed fingerprint from markdown content
 */
export interface ParsedFingerprint {
  /** The fingerprint string */
  fingerprint: string;
  /** Start index in the markdown content */
  startIndex: number;
  /** End index in the markdown content */
  endIndex: number;
}

/**
 * Parse embedded fingerprints from markdown content
 * @param markdown Markdown content with embedded fingerprints
 * @returns Array of parsed fingerprints with their positions
 */
export function parseFingerprintsFromMarkdown(markdown: string): ParsedFingerprint[] {
  const regex = /<!--fp:([a-z0-9]{8})-->/g;
  const results: ParsedFingerprint[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(markdown)) !== null) {
    results.push({
      fingerprint: match[1],
      startIndex: match.index,
      endIndex: match.index + match[0].length,
    });
  }

  return results;
}

/**
 * Selector map entry parsed from markdown
 */
export interface SelectorMapEntry {
  /** Full fingerprint (16 chars) */
  fingerprint: string;
  /** Element tag name */
  tagName: string;
  /** Text preview from the element */
  textPreview: string;
}

/**
 * Parse selector map from markdown content.
 * Matches entries in the format: `fp:abc12345def67890 | tagName | "text preview"`
 *
 * @param markdown Markdown content with selector map
 * @returns Array of selector map entries
 */
export function parseSelectorMap(markdown: string): SelectorMapEntry[] {
  // Matches: fp:<16-char fingerprint> | <tag name> | "text preview"
  // Tag name pattern allows hyphens for custom elements (e.g., my-component)
  const regex = /fp:([a-z0-9]{16})\s*\|\s*([\w-]+)\s*\|\s*"((?:[^"\\]|\\.)*)"/g;
  const results: SelectorMapEntry[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(markdown)) !== null) {
    // Unescape escaped characters in the text preview
    results.push({
      fingerprint: match[1],
      tagName: match[2],
      textPreview: match[3]
        .replace(/\\"/g, '"')
        .replace(/\\\|/g, "|")
        .replace(/\\\\/g, "\\"),
    });
  }

  return results;
}

/**
 * Find an element in the DOM by its fingerprint
 * Walks the DOM tree and generates fingerprints for elements until a match is found
 *
 * @param root The root element to search from (usually document.body)
 * @param fingerprint The fingerprint to search for (short 8-char or full 16-char)
 * @param options Fingerprint generation options (must match those used to generate the fingerprint)
 * @param timeout Maximum time in milliseconds to spend searching (default: 5000)
 * @returns The matching element, or null if not found or timeout exceeded
 */
export function findElementByFingerprint(
  root: Element,
  fingerprint: string,
  options: Partial<FingerprintOptions> = {},
  timeout: number = 5000,
): Element | null {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Validate fingerprint format before traversing the entire DOM
  if (!/^[a-z0-9]{8}([a-z0-9]{8})?$/.test(fingerprint)) {
    return null;
  }

  const isShortFingerprint = fingerprint.length === 8;
  const startTime = Date.now();

  // Use TreeWalker for efficient traversal, skipping highlight overlays
  const walker = root.ownerDocument!.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node: Node): number {
        // Skip highlight overlay subtrees entirely
        if (isHighlightOverlay(node as Element)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let node: Node | null;
  let elementCount = 0;

  while ((node = walker.nextNode())) {
    // Check timeout periodically (every 100 elements)
    elementCount++;
    if (elementCount % 100 === 0 && Date.now() - startTime > timeout) {
      console.warn(
        `findElementByFingerprint: Timeout after ${elementCount} elements`,
      );
      return null;
    }

    const element = node as Element;
    // Also skip excluded structural elements
    if (STRUCTURAL_EXCLUDED_TAGS.has(element.nodeName)) {
      continue;
    }
    const fp = generateFingerprint(element, opts);

    // Match against short or full fingerprint
    if (isShortFingerprint) {
      if (fp.short === fingerprint) {
        return element;
      }
    } else {
      if (fp.full === fingerprint || fp.short === fingerprint) {
        return element;
      }
    }
  }

  return null;
}

/**
 * Find all elements matching a fingerprint (in case of duplicates)
 *
 * @param root The root element to search from
 * @param fingerprint The fingerprint to search for
 * @param options Fingerprint generation options
 * @param timeout Maximum time in milliseconds to spend searching (default: 5000)
 * @returns Array of matching elements
 */
export function findElementsByFingerprint(
  root: Element,
  fingerprint: string,
  options: Partial<FingerprintOptions> = {},
  timeout: number = 5000,
): Element[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Validate fingerprint format before traversing the entire DOM
  if (!/^[a-z0-9]{8}([a-z0-9]{8})?$/.test(fingerprint)) {
    return [];
  }

  const isShortFingerprint = fingerprint.length === 8;
  const matches: Element[] = [];
  const startTime = Date.now();

  // Use TreeWalker with highlight overlay filtering
  const walker = root.ownerDocument!.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node: Node): number {
        if (isHighlightOverlay(node as Element)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let node: Node | null;
  let elementCount = 0;

  while ((node = walker.nextNode())) {
    // Check timeout periodically (every 100 elements)
    elementCount++;
    if (elementCount % 100 === 0 && Date.now() - startTime > timeout) {
      console.warn(
        `findElementsByFingerprint: Timeout after ${elementCount} elements, returning ${matches.length} matches found so far`,
      );
      break;
    }

    const element = node as Element;
    if (STRUCTURAL_EXCLUDED_TAGS.has(element.nodeName)) {
      continue;
    }
    const fp = generateFingerprint(element, opts);

    if (isShortFingerprint) {
      if (fp.short === fingerprint) {
        matches.push(element);
      }
    } else {
      if (fp.full === fingerprint || fp.short === fingerprint) {
        matches.push(element);
      }
    }
  }

  return matches;
}

/**
 * Element locator options - supports either CSS selector or fingerprint
 */
export interface ElementLocator {
  /** CSS selector (e.g., "#submitBtn", "button.primary") */
  selector?: string;
  /** Element fingerprint from Markdown output (e.g., "01apofgi") */
  fingerprint?: string;
}

/**
 * Resolve an element locator to an actual DOM element
 * Supports both CSS selectors and fingerprints, with selector taking priority
 *
 * @param document The document to search in
 * @param locator The element locator (selector or fingerprint)
 * @param options Fingerprint options (used when locator.fingerprint is provided)
 * @returns The found element, or null if not found
 */
export function resolveElementLocator(
  document: Document,
  locator: ElementLocator,
  options: Partial<FingerprintOptions> = {},
): Element | null {
  // Priority: selector > fingerprint
  if (locator.selector) {
    return document.querySelector(locator.selector);
  }

  if (locator.fingerprint && document.body) {
    return findElementByFingerprint(document.body, locator.fingerprint, options);
  }

  return null;
}
