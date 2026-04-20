// https://core.telegram.org/bots/api#sendmessage
// > Text of the message to be sent, 1-4096 characters after entities parsing
export const MESSAGE_SPLIT_BUDGET = 3900;

export class ReplyManager {
  options: {
    send: (text: string) => Promise<unknown>;
    limit: number;
  };
  buffer = "";
  sent = false;

  constructor(options: ReplyManager["options"]) {
    this.options = options;
  }

  async send(text: string): Promise<void> {
    const parts = splitMessageText(text, this.options.limit);
    for (const part of parts) {
      await this.options.send(part);
    }
    this.sent = true;
  }

  async system(text: string): Promise<void> {
    await this.send(`[⚙️ System]\n${text}`);
  }

  async write(text: string): Promise<void> {
    this.buffer += text;
    while (this.buffer.length > this.options.limit) {
      const result = splitHead(this.buffer, this.options.limit);
      this.buffer = result.tail;
      const part = result.head.trim();
      if (part) {
        await this.send(part);
      }
    }
  }

  async flush(): Promise<void> {
    if (!this.buffer.trim()) {
      this.buffer = "";
      return;
    }
    await this.send(this.buffer);
    this.buffer = "";
  }

  async finish(): Promise<void> {
    await this.flush();
    if (!this.sent) {
      await this.send("(no response)");
    }
  }
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
