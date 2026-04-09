const MARKDOWN_V2_SPECIAL_CHARS = /[\\_*\[\]()~`>#+\-=|{}.!]/g;

export function escapeTelegramMarkdownV2(text: string): string {
  return text.replaceAll(MARKDOWN_V2_SPECIAL_CHARS, "\\$&");
}

export function buildTelegramReply(text: string): { text: string; parse_mode: "MarkdownV2" } {
  return {
    text: escapeTelegramMarkdownV2(text),
    parse_mode: "MarkdownV2",
  };
}
