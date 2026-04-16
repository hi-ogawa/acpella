import type { List, ListItem, PhrasingContent, RootContent, Table } from "mdast";
import type { Options as FromMarkdownOptions } from "mdast-util-from-markdown";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

// TODO: review slop

const MARKDOWN_PARSE_OPTIONS = {
  extensions: [gfm()],
  mdastExtensions: [gfmFromMarkdown()],
} satisfies FromMarkdownOptions;

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
let fileReferencePattern: RegExp | undefined;
let orphanedTldPattern: RegExp | undefined;

export function markdownToTelegramHtml(markdown: string): string {
  const ast = fromMarkdown(markdown, MARKDOWN_PARSE_OPTIONS);
  return renderBlocks(ast.children, { wrapFileRefs: true });
}

type RenderContext = {
  listMarker?: string;
  wrapFileRefs: boolean;
};

function renderBlock(node: RootContent, options: RenderContext): string {
  switch (node.type) {
    case "blockquote": {
      // Telegram Bot API supports <blockquote>; OpenClaw's Telegram renderer uses this tag.
      const body = renderBlocks(node.children, options).trim();
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
      return `<s>${renderInline(node.children, options)}</s>`;
    }
    case "emphasis": {
      // Telegram Bot API supports <i> for italic in HTML parse mode.
      return `<i>${renderInline(node.children, options)}</i>`;
    }
    case "footnoteReference": {
      return escapeHtml(`[${node.label ?? node.identifier}]`);
    }
    case "heading": {
      // Telegram has no heading tags; OpenClaw flattens headings instead of emitting generic HTML.
      const body = renderInline(node.children, options);
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
      return renderInline(node.children, options);
    }
    case "list": {
      // Telegram HTML does not support list tags; OpenClaw renders lists as plain text bullets.
      return renderList(node, options);
    }
    case "listItem": {
      return renderListItem(node, options);
    }
    case "paragraph": {
      return renderInline(node.children, options);
    }
    case "strong": {
      // Telegram Bot API supports <b> for bold in HTML parse mode.
      return `<b>${renderInline(node.children, options)}</b>`;
    }
    case "table": {
      return renderTable(node);
    }
    case "tableCell": {
      return renderInline(node.children, options);
    }
    case "tableRow": {
      return node.children.map((cell) => renderBlock(cell, options).trim()).join(" | ");
    }
    case "text": {
      return options.wrapFileRefs
        ? renderTextWithFileReferences(node.value)
        : escapeHtml(node.value);
    }
    case "thematicBreak": {
      return "---";
    }
    case "yaml": {
      return escapeHtml(node.value);
    }
    default: {
      return node satisfies never;
    }
  }
}

function renderBlocks(nodes: readonly RootContent[], options: RenderContext): string {
  return nodes
    .map((node) => renderBlock(node, options))
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function renderInline(nodes: readonly PhrasingContent[], options: RenderContext): string {
  return nodes.map((node) => renderBlock(node, options)).join("");
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
  const label = renderInline(children, { wrapFileRefs: false });
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

function renderList(list: List, options: RenderContext): string {
  const start = list.ordered && typeof list.start === "number" ? list.start : 1;
  return list.children
    .map((item, index) =>
      renderBlock(item, {
        ...options,
        listMarker: list.ordered ? `${start + index}.` : "-",
      }),
    )
    .filter((text) => text.length > 0)
    .join("\n");
}

function renderListItem(item: ListItem, options: RenderContext): string {
  const marker = options.listMarker ?? "-";
  const body = item.children
    .map((child) => renderBlock(child, options))
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
  return table.children.map((row) => renderBlock(row, { wrapFileRefs: true })).join("\n");
}

function renderTextWithFileReferences(text: string): string {
  // OpenClaw policy, applied at AST text-render time here: wrap standalone file refs to avoid Telegram previews.
  const pattern = getFileReferencePattern();
  pattern.lastIndex = 0;

  let result = "";
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const prefix = match[1] ?? "";
    const filename = match[2] ?? "";
    result += renderTextSegmentWithOrphanedTlds(text.slice(index, match.index));
    result += renderStandaloneFileRef(match[0], prefix, filename);
    index = match.index + match[0].length;
  }

  result += renderTextSegmentWithOrphanedTlds(text.slice(index));
  return result;
}

function renderTextSegmentWithOrphanedTlds(text: string): string {
  const pattern = getOrphanedTldPattern();
  pattern.lastIndex = 0;

  let result = "";
  let index = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const prefix = match[1] ?? "";
    const tld = match[2] ?? "";
    result += escapeHtml(text.slice(index, match.index));
    result +=
      prefix === ">"
        ? escapeHtml(match[0])
        : `${escapeHtml(prefix)}<code>${escapeHtml(tld)}</code>`;
    index = match.index + match[0].length;
  }

  result += escapeHtml(text.slice(index));
  return result;
}

function renderStandaloneFileRef(match: string, prefix: string, filename: string): string {
  if (filename.startsWith("//") || /https?:\/\/$/i.test(prefix)) {
    return escapeHtml(match);
  }
  return `${escapeHtml(prefix)}<code>${escapeHtml(filename)}</code>`;
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

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
