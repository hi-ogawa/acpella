// TODO: link to reference
export const MESSAGE_SPLIT_BUDGET = 3900;

export interface ReplyContext {
  reply: (text: string) => Promise<unknown>;
}

export type Reply = ReturnType<typeof createReply>;

export function createReply(options: { context: ReplyContext; limit: number }) {
  let buffer = "";
  let sent = false;

  async function send(text: string): Promise<void> {
    const parts = splitMessageText(text, options.limit);
    for (const part of parts) {
      await options.context.reply(part);
    }
    sent = true;
  }

  async function write(text: string): Promise<void> {
    buffer += text;
    while (buffer.length > options.limit) {
      const result = splitHead(buffer, options.limit);
      buffer = result.tail;
      const part = result.head.trim();
      if (part) {
        await send(part);
      }
    }
  }

  async function flush(): Promise<void> {
    if (!buffer.trim()) {
      buffer = "";
      return;
    }
    await send(buffer);
    buffer = "";
  }

  return {
    send,
    write,
    flush,
    system: (text: string) => {
      return send(`[⚙️ System]\n${text}`);
    },
    finish: async () => {
      await flush();
      if (!sent) {
        await send("(no response)");
      }
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
  // found, hard-split at the limit. Paragraphs can produce slightly smaller
  // chunks because they are stronger boundaries; weaker boundaries must be in
  // the latter half so we do not send tiny leading fragments just to preserve
  // a very early separator.
  const splitters = [
    { value: "\n\n", minRatio: 0.3 },
    { value: "\n", minRatio: 0.5 },
    { value: " ", minRatio: 0.5 },
  ];
  for (const splitter of splitters) {
    const index = text.lastIndexOf(splitter.value, limit);
    if (index > limit * splitter.minRatio) {
      return index + splitter.value.length;
    }
  }
  return limit;
}

function splitHead(text: string, limit: number): { head: string; tail: string } {
  const splitIndex = findSplitIndex(text, limit);
  return {
    head: text.slice(0, splitIndex),
    tail: text.slice(splitIndex),
  };
}
