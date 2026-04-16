import type { List, ListItem, PhrasingContent, RootContent, Table } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tg:"]);

export function toTelegramHtml(markdown: string): string {
  return renderBlocks(fromMarkdown(markdown).children);
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

function isSafeLinkUrl(url: string): boolean {
  if (!url || /[\u0000-\u001F\u007F\s]/.test(url)) {
    return false;
  }
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}

function escapeHtml(text: string): string {
  // Telegram HTML requires raw &, <, and > text to be escaped.
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeHtmlAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}
