// TODO: link to reference
export const MESSAGE_SPLIT_BUDGET = 3900;

export interface ReplyContext {
  reply: (text: string) => Promise<unknown>;
}

export type Reply = ReturnType<typeof createReply>;

export function createReply(options: { context: ReplyContext; limit: number }) {
  async function send(text: string): Promise<void> {
    const parts = splitMessageText(text, options.limit);
    for (const part of parts) {
      await options.context.reply(part);
    }
  }

  return {
    send,
    system(text: string) {
      return send(`[⚙️ System]\n${text}`);
    },
    stream() {
      return createResponseWriter({
        limit: options.limit,
        send,
      });
    },
  };
}

function splitMessageText(text: string, limit: number): string[] {
  const parts: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    const result = splitHead(remaining, limit);
    const part = result.head.trim();
    if (part) {
      parts.push(part);
    }
    remaining = result.tail.trim();
  }
  if (remaining) {
    parts.push(remaining);
  }
  return parts;
}

function findSplitIndex(text: string, limit: number): number {
  // Split at the best available natural boundary before the limit:
  // paragraph break first, then line break, then word space. If none are
  // found, hard-split at the limit. The boundary must be in the latter half
  // of the chunk so we do not send tiny leading fragments just to preserve a
  // very early separator.
  // TODO: should divions heuristics adjusted based on splitter?
  // e.g. paragraph split can be more chunkier.
  const paragraphIndex = text.lastIndexOf("\n\n", limit);
  if (paragraphIndex > limit / 2) {
    return paragraphIndex + 2;
  }
  const lineIndex = text.lastIndexOf("\n", limit);
  if (lineIndex > limit / 2) {
    return lineIndex + 1;
  }
  const spaceIndex = text.lastIndexOf(" ", limit);
  if (spaceIndex > limit / 2) {
    return spaceIndex + 1;
  }
  return limit;
}

function createResponseWriter(options: { limit: number; send: (text: string) => Promise<void> }) {
  let bufferedText = "";
  let sentResponse = false;

  async function send(text: string): Promise<void> {
    await options.send(text);
    sentResponse = true;
  }

  async function flush(): Promise<void> {
    if (!bufferedText.trim()) {
      bufferedText = "";
      return;
    }
    await send(bufferedText);
    bufferedText = "";
  }

  async function flushOversizedText(): Promise<void> {
    while (bufferedText.length > options.limit) {
      const result = splitHead(bufferedText, options.limit);
      bufferedText = result.tail;
      const part = result.head.trim();
      if (part) {
        await send(part);
      }
    }
  }

  return {
    async write(text: string): Promise<void> {
      bufferedText += text;
      await flushOversizedText();
    },
    flush,
    async finish(): Promise<void> {
      await flush();
      if (!sentResponse) {
        await send("(no response)");
      }
    },
  };
}

function splitHead(text: string, limit: number): { head: string; tail: string } {
  const splitIndex = findSplitIndex(text, limit);
  return {
    head: text.slice(0, splitIndex),
    tail: text.slice(splitIndex),
  };
}
