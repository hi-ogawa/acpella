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
};

class TelegramHtmlRenderer {
  context: RenderContext = {
    listItemPrefix: "-",
  };

  renderRoot(root: Root) {
    return this.renderBlocks(root.children);
  }

  renderBlock(node: RootContent): string {
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
        return renderImageText(node.alt);
      }
      case "imageReference": {
        return renderImageText(node.alt);
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
        return escapeHtml(node.value);
      }
      case "thematicBreak": {
        return "---";
      }
      case "yaml": {
        return escapeHtml(node.value);
      }
      default: {
        node satisfies never;
        return "";
      }
    }
  }

  renderBlocks(nodes: readonly RootContent[]): string {
    return nodes
      .map((node) => this.renderBlock(node))
      .filter((text) => text.length > 0)
      .join("\n\n");
  }

  renderInline(nodes: readonly PhrasingContent[]): string {
    return nodes.map((node) => this.renderBlock(node)).join("");
  }

  renderLink(rawUrl: string, children: readonly PhrasingContent[]): string {
    const label = this.renderInline(children);
    const url = rawUrl.trim();
    if (!label || !isSafeLinkUrl(url)) {
      return label;
    }
    // Telegram Bot API supports <a href="..."> links; keep hrefs scheme-allowlisted.
    return `<a href="${escapeHtmlAttr(url)}">${label}</a>`;
  }

  renderList(list: List): string {
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

  renderListItem(item: ListItem): string {
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

  renderTable(table: Table): string {
    return table.children.map((row) => this.renderBlock(row)).join("\n");
  }

  withContent(patch: Partial<RenderContext>, render: () => string): string {
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
  const language = rawLanguage?.trim();
  // Telegram supports <pre><code> and optional language-* class on <code>.
  const classAttr = language && /^[\w-]+$/.test(language) ? ` class="language-${language}"` : "";
  return `<pre><code${classAttr}>${escapeHtml(code)}</code></pre>`;
}

function renderImageText(alt: string | null | undefined): string {
  const label = alt?.trim();
  return label ? escapeHtml(`[Image: ${label}]`) : "[Image]";
}

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tg:"]);

function isSafeLinkUrl(url: string): boolean {
  // WHATWG URL parsing strips leading/trailing C0 control-or-space (U+0000-U+0020)
  // and removes ASCII tab/newline after flagging invalid-URL-unit. U+007F is also
  // outside the URL code point set.
  // https://url.spec.whatwg.org/#concept-basic-url-parser
  // https://url.spec.whatwg.org/#url-code-points
  // oxlint-disable-next-line no-control-regex
  if (!url || /[\u0000-\u0020\u007f]/u.test(url)) {
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
