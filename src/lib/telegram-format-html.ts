import type { List, ListItem, PhrasingContent, RootContent, Table } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tg:"]);
const FILE_REF_EXTENSIONS_WITH_TLD = new Set([
  "md",
  "go",
  "py",
  "pl",
  "sh",
  "am",
  "at",
  "be",
  "cc",
]);
const AUTO_LINKED_ANCHOR_PATTERN = /<a\s+href="https?:\/\/([^"]+)"[^>]*>\1<\/a>/gi;
const HTML_TAG_PATTERN = /(<\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?>/gi;
let fileReferencePattern: RegExp | undefined;
let orphanedTldPattern: RegExp | undefined;

export function toTelegramHtml(markdown: string): string {
  return wrapFileReferencesInHtml(renderBlocks(fromMarkdown(markdown).children));
}

function renderBlocks(nodes: readonly RootContent[]): string {
  return nodes
    .map((node) => renderBlock(node))
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function renderBlock(node: RootContent): string {
  switch (node.type) {
    case "blockquote": {
      // Telegram Bot API supports <blockquote>; OpenClaw's Telegram renderer uses this tag.
      const body = renderBlocks(node.children).trim();
      return body ? `<blockquote>${body}</blockquote>` : "";
    }
    case "break": {
      return "\n";
    }
    case "code": {
      return renderCodeBlock(node.value, node.lang);
    }
    case "definition":
    case "footnoteDefinition": {
      return "";
    }
    case "delete": {
      // Telegram Bot API supports <s> for strikethrough in HTML parse mode.
      return `<s>${renderInline(node.children)}</s>`;
    }
    case "emphasis": {
      // Telegram Bot API supports <i> for italic in HTML parse mode.
      return `<i>${renderInline(node.children)}</i>`;
    }
    case "footnoteReference": {
      return escapeHtml(`[${node.label ?? node.identifier}]`);
    }
    case "heading": {
      // Telegram has no heading tags; OpenClaw flattens headings instead of emitting generic HTML.
      const body = renderInline(node.children);
      return body ? `<b>${body}</b>` : "";
    }
    case "html": {
      // Do not pass raw Markdown HTML through; render our own Telegram allowlist only.
      return escapeHtml(node.value);
    }
    case "image": {
      return renderImageText(node.alt, node.url);
    }
    case "imageReference": {
      return renderImageText(node.alt, node.label ?? node.identifier);
    }
    case "inlineCode": {
      // Telegram Bot API supports <code> for inline code in HTML parse mode.
      return `<code>${escapeHtml(node.value)}</code>`;
    }
    case "link": {
      return renderLink(node.url, node.children);
    }
    case "linkReference": {
      return renderInline(node.children);
    }
    case "list": {
      // Telegram HTML does not support list tags; OpenClaw renders lists as plain text bullets.
      return renderList(node);
    }
    case "listItem": {
      return renderListItem(node, "-");
    }
    case "paragraph": {
      return renderInline(node.children);
    }
    case "strong": {
      // Telegram Bot API supports <b> for bold in HTML parse mode.
      return `<b>${renderInline(node.children)}</b>`;
    }
    case "table": {
      return renderTable(node);
    }
    case "tableCell": {
      return renderInline(node.children);
    }
    case "tableRow": {
      return node.children.map((cell) => renderInline(cell.children).trim()).join(" | ");
    }
    case "text": {
      return escapeHtml(node.value);
    }
    case "thematicBreak": {
      return "---";
    }
    case "yaml": {
      return escapeHtml(node.value);
    }
  }
}

function renderInline(nodes: readonly PhrasingContent[]): string {
  return nodes.map((node) => renderBlock(node)).join("");
}

function renderCodeBlock(code: string, rawLanguage?: string | null): string {
  const language = sanitizeCodeLanguage(rawLanguage);
  // Telegram supports <pre><code> and optional language-* class on <code>.
  const classAttr = language ? ` class="language-${language}"` : "";
  return `<pre><code${classAttr}>${escapeHtml(code)}</code></pre>`;
}

function sanitizeCodeLanguage(rawLanguage?: string | null): string {
  const language = rawLanguage?.trim().split(/\s+/)[0] ?? "";
  return language.replace(/[^A-Za-z0-9_-]/g, "");
}

function renderLink(rawUrl: string, children: readonly PhrasingContent[]): string {
  const label = renderInline(children);
  const url = rawUrl.trim();
  if (!label || !isSafeLinkUrl(url)) {
    return label;
  }
  // Telegram Bot API supports <a href="..."> links; keep hrefs scheme-allowlisted.
  return `<a href="${escapeHtmlAttr(url)}">${label}</a>`;
}

function renderImageText(alt: string | null | undefined, fallback: string): string {
  const label = alt?.trim() || fallback.trim();
  return label ? escapeHtml(`[Image: ${label}]`) : "[Image]";
}

function renderList(list: List): string {
  const start = list.ordered && typeof list.start === "number" ? list.start : 1;
  return list.children
    .map((item, index) => renderListItem(item, list.ordered ? `${start + index}.` : "-"))
    .filter((text) => text.length > 0)
    .join("\n");
}

function renderListItem(item: ListItem, marker: string): string {
  const body = item.children
    .map((child) => renderBlock(child))
    .filter((text) => text.length > 0)
    .join("\n");
  if (!body) {
    return marker;
  }

  const continuationPrefix = " ".repeat(marker.length + 1);
  return body
    .split("\n")
    .map((line, index) => `${index === 0 ? `${marker} ` : continuationPrefix}${line}`)
    .join("\n");
}

function renderTable(table: Table): string {
  return table.children.map((row) => renderBlock(row)).join("\n");
}

function wrapFileReferencesInHtml(html: string): string {
  AUTO_LINKED_ANCHOR_PATTERN.lastIndex = 0;
  const deLinkified = html.replace(AUTO_LINKED_ANCHOR_PATTERN, (match, label: string) => {
    if (!isAutoLinkedFileRef(`http://${label}`, label)) {
      return match;
    }
    return `<code>${escapeHtml(label)}</code>`;
  });

  let codeDepth = 0;
  let preDepth = 0;
  let anchorDepth = 0;
  let result = "";
  let lastIndex = 0;

  // OpenClaw technique: scan rendered Telegram HTML token-by-token so file-ref wrapping skips protected tags.
  HTML_TAG_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = HTML_TAG_PATTERN.exec(deLinkified)) !== null) {
    const tagStart = match.index;
    const tagEnd = HTML_TAG_PATTERN.lastIndex;
    const isClosing = match[1] === "</";
    const tagName = normalizeLowercaseStringOrEmpty(match[2]);

    result += wrapSegmentFileRefs(deLinkified.slice(lastIndex, tagStart), {
      codeDepth,
      preDepth,
      anchorDepth,
    });

    if (tagName === "code") {
      codeDepth = isClosing ? Math.max(0, codeDepth - 1) : codeDepth + 1;
    } else if (tagName === "pre") {
      preDepth = isClosing ? Math.max(0, preDepth - 1) : preDepth + 1;
    } else if (tagName === "a") {
      anchorDepth = isClosing ? Math.max(0, anchorDepth - 1) : anchorDepth + 1;
    }

    result += deLinkified.slice(tagStart, tagEnd);
    lastIndex = tagEnd;
  }

  result += wrapSegmentFileRefs(deLinkified.slice(lastIndex), {
    codeDepth,
    preDepth,
    anchorDepth,
  });

  return result;
}

function wrapSegmentFileRefs(
  text: string,
  options: { codeDepth: number; preDepth: number; anchorDepth: number },
): string {
  if (!text || options.codeDepth > 0 || options.preDepth > 0 || options.anchorDepth > 0) {
    return text;
  }
  const wrappedStandalone = text.replace(getFileReferencePattern(), wrapStandaloneFileRef);
  return wrappedStandalone.replace(getOrphanedTldPattern(), (match, prefix: string, tld: string) =>
    prefix === ">" ? match : `${prefix}<code>${escapeHtml(tld)}</code>`,
  );
}

function wrapStandaloneFileRef(match: string, prefix: string, filename: string): string {
  if (filename.startsWith("//") || /https?:\/\/$/i.test(prefix)) {
    return match;
  }
  return `${prefix}<code>${escapeHtml(filename)}</code>`;
}

function getFileReferencePattern(): RegExp {
  if (fileReferencePattern) {
    return fileReferencePattern;
  }
  const fileExtensionsPattern = Array.from(FILE_REF_EXTENSIONS_WITH_TLD).map(escapeRegex).join("|");
  fileReferencePattern = new RegExp(
    `(^|[^a-zA-Z0-9_\\-/])([a-zA-Z0-9_.\\-./]+\\.(?:${fileExtensionsPattern}))(?=$|[^a-zA-Z0-9_\\-/])`,
    "gi",
  );
  return fileReferencePattern;
}

function getOrphanedTldPattern(): RegExp {
  if (orphanedTldPattern) {
    return orphanedTldPattern;
  }
  const fileExtensionsPattern = Array.from(FILE_REF_EXTENSIONS_WITH_TLD).map(escapeRegex).join("|");
  orphanedTldPattern = new RegExp(
    `([^a-zA-Z0-9]|^)([A-Za-z]\\.(?:${fileExtensionsPattern}))(?=[^a-zA-Z0-9/]|$)`,
    "g",
  );
  return orphanedTldPattern;
}

function isAutoLinkedFileRef(href: string, label: string): boolean {
  const stripped = href.replace(/^https?:\/\//i, "");
  if (stripped !== label) {
    return false;
  }
  const dotIndex = label.lastIndexOf(".");
  if (dotIndex < 1) {
    return false;
  }
  const ext = normalizeLowercaseStringOrEmpty(label.slice(dotIndex + 1));
  if (!FILE_REF_EXTENSIONS_WITH_TLD.has(ext)) {
    return false;
  }
  const segments = label.split("/");
  if (segments.length > 1) {
    for (let i = 0; i < segments.length - 1; i++) {
      if (segments[i]?.includes(".")) {
        return false;
      }
    }
  }
  return true;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeLowercaseStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isSafeLinkUrl(url: string): boolean {
  if (!url || hasUrlUnsafeWhitespaceOrControl(url)) {
    return false;
  }
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

function hasUrlUnsafeWhitespaceOrControl(url: string): boolean {
  for (const char of url) {
    const code = char.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function escapeHtml(text: string): string {
  // Telegram HTML requires raw &, <, and > text to be escaped.
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}
