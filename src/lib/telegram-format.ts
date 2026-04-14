const TEXT_MARKDOWN_V2_SPECIAL_CHARS = new Set("\\_*[]()~`>#+-=|{}.!");
const CODE_MARKDOWN_V2_SPECIAL_CHARS = new Set("\\`");
const URL_MARKDOWN_V2_SPECIAL_CHARS = new Set("\\)");

export function toTelegramMarkdownV2(text: string): string {
  let result = "";
  let index = 0;
  const fencePattern = /```([^\n`]*)\n?([\s\S]*?)```/g;

  for (const match of text.matchAll(fencePattern)) {
    result += formatInlineMarkdown(text.slice(index, match.index));
    result += formatCodeFence({
      language: match[1],
      code: match[2],
    });
    index = match.index + match[0].length;
  }

  result += formatInlineMarkdown(text.slice(index));
  return result;
}

function formatCodeFence(options: { language: string; code: string }): string {
  const language =
    options.language
      .trim()
      .split(/\s+/)[0]
      ?.replace(/[^A-Za-z0-9_+-]/g, "") ?? "";
  const suffix = language ? language : "";
  return `\`\`\`${suffix}\n${escapeMarkdownV2(options.code, CODE_MARKDOWN_V2_SPECIAL_CHARS)}\`\`\``;
}

function formatInlineMarkdown(text: string): string {
  let result = "";
  let index = 0;

  while (index < text.length) {
    if (text[index] === "`") {
      const end = text.indexOf("`", index + 1);
      if (end !== -1) {
        result += `\`${escapeMarkdownV2(text.slice(index + 1, end), CODE_MARKDOWN_V2_SPECIAL_CHARS)}\``;
        index = end + 1;
        continue;
      }
    }

    if (text.startsWith("**", index)) {
      const end = text.indexOf("**", index + 2);
      if (end !== -1) {
        result += `*${escapeMarkdownV2(text.slice(index + 2, end), TEXT_MARKDOWN_V2_SPECIAL_CHARS)}*`;
        index = end + 2;
        continue;
      }
    }

    if (text[index] === "[") {
      const labelEnd = text.indexOf("]", index + 1);
      if (labelEnd !== -1 && text[labelEnd + 1] === "(") {
        const urlEnd = text.indexOf(")", labelEnd + 2);
        if (urlEnd !== -1) {
          result += `[${escapeMarkdownV2(
            text.slice(index + 1, labelEnd),
            TEXT_MARKDOWN_V2_SPECIAL_CHARS,
          )}](${escapeMarkdownV2(text.slice(labelEnd + 2, urlEnd), URL_MARKDOWN_V2_SPECIAL_CHARS)})`;
          index = urlEnd + 1;
          continue;
        }
      }
    }

    result += escapeMarkdownV2(text[index], TEXT_MARKDOWN_V2_SPECIAL_CHARS);
    index++;
  }

  return result;
}

function escapeMarkdownV2(text: string, specialChars: Set<string>): string {
  let result = "";
  for (const char of text) {
    result += specialChars.has(char) ? `\\${char}` : char;
  }
  return result;
}
