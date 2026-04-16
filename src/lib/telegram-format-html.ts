import type { List, ListItem, PhrasingContent, Root, RootContent, Table } from "mdast";
import type { Options as FromMarkdownOptions } from "mdast-util-from-markdown";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

const MARKDOWN_PARSE_OPTIONS = {
  extensions: [gfm()],
  mdastExtensions: [gfmFromMarkdown()],
} satisfies FromMarkdownOptions;

export function markdownToTelegramHtml(markdown: string): string {
  const ast = fromMarkdown(markdown, MARKDOWN_PARSE_OPTIONS);
  return new TelegramHtmlRenderer().renderRoot(ast);
}

type RenderContext = {
  listItemPrefix: string;
  wrapFileRefs: boolean;
};

class TelegramHtmlRenderer {
  private context: RenderContext = {
    listItemPrefix: "-",
    wrapFileRefs: true,
  };

  renderRoot(root: Root) {
    return this.renderBlocks(root.children);
  }

  private renderBlock(node: RootContent): string {
    switch (node.type) {
      case "blockquote": {
        // Telegram Bot API supports <blockquote>; OpenClaw's Telegram renderer uses this tag.
        const body = this.renderBlocks(node.children).trim();
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
        return `<s>${this.renderInline(node.children)}</s>`;
      }
      case "emphasis": {
        // Telegram Bot API supports <i> for italic in HTML parse mode.
        return `<i>${this.renderInline(node.children)}</i>`;
      }
      case "footnoteReference": {
        return escapeHtml(`[${node.label ?? node.identifier}]`);
      }
      case "heading": {
        // Telegram has no heading tags; OpenClaw flattens headings instead of emitting generic HTML.
        const body = this.renderInline(node.children);
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
        return this.renderLink(node.url, node.children);
      }
      case "linkReference": {
        return this.renderInline(node.children);
      }
      case "list": {
        // Telegram HTML does not support list tags; OpenClaw renders lists as plain text bullets.
        return this.renderList(node);
      }
      case "listItem": {
        return this.renderListItem(node);
      }
      case "paragraph": {
        return this.renderInline(node.children);
      }
      case "strong": {
        // Telegram Bot API supports <b> for bold in HTML parse mode.
        return `<b>${this.renderInline(node.children)}</b>`;
      }
      case "table": {
        return this.renderTable(node);
      }
      case "tableCell": {
        return this.renderInline(node.children);
      }
      case "tableRow": {
        return node.children.map((cell) => this.renderBlock(cell).trim()).join(" | ");
      }
      case "text": {
        return this.context.wrapFileRefs
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

  renderBlocks(nodes: readonly RootContent[]): string {
    return nodes
      .map((node) => this.renderBlock(node))
      .filter((text) => text.length > 0)
      .join("\n\n");
  }

  private renderInline(nodes: readonly PhrasingContent[]): string {
    return nodes.map((node) => this.renderBlock(node)).join("");
  }

  private renderLink(rawUrl: string, children: readonly PhrasingContent[]): string {
    const label = this.withContent({ wrapFileRefs: false }, () => this.renderInline(children));
    const url = rawUrl.trim();
    if (!label || !isSafeLinkUrl(url)) {
      return label;
    }
    // Telegram Bot API supports <a href="..."> links; keep hrefs scheme-allowlisted.
    return `<a href="${escapeHtmlAttr(url)}">${label}</a>`;
  }

  private renderList(list: List): string {
    return list.children
      .map((item, index) =>
        this.withContent(
          {
            listItemPrefix: list.start != null ? `${list.start + index}.` : "-",
          },
          () => this.renderBlock(item),
        ),
      )
      .filter((text) => text.length > 0)
      .join("\n");
  }

  private renderListItem(item: ListItem): string {
    const prefix = this.context.listItemPrefix;
    const body = item.children
      .map((child) => this.renderBlock(child))
      .filter((text) => text.length > 0)
      .join("\n");
    if (!body) {
      return prefix;
    }

    const prefixIndent = " ".repeat(prefix.length + 1);
    return body
      .split("\n")
      .map((line, index) => `${index === 0 ? `${prefix} ` : prefixIndent}${line}`)
      .join("\n");
  }

  private renderTable(table: Table): string {
    return table.children.map((row) => this.renderBlock(row)).join("\n");
  }

  private withContent(patch: Partial<RenderContext>, render: () => string): string {
    const previous = this.context;
    this.context = { ...previous, ...patch };
    try {
      return render();
    } finally {
      this.context = previous;
    }
  }
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

function renderImageText(alt: string | null | undefined, fallback: string): string {
  const label = alt?.trim() || fallback.trim();
  return label ? escapeHtml(`[Image: ${label}]`) : "[Image]";
}

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tg:"]);

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

// ported from
// https://github.com/openclaw/openclaw/blob/05cac5b980f60f2de9f27332c3bc55f6ff9f64e0/extensions/telegram/src/format.ts#L94-L101

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

function renderTextWithFileReferences(text: string): string {
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
