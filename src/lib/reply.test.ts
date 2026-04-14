import { describe, expect, it } from "vitest";
import { createReply } from "./reply.ts";

function createReplyTest(options: { limit: number }) {
  const messages: string[] = [];
  const reply = createReply({
    context: {
      async reply(text: string): Promise<void> {
        messages.push(text);
      },
    },
    limit: options.limit,
  });
  return { reply, messages };
}

describe(createReply, () => {
  it("sends short text as-is", async () => {
    const { reply, messages } = createReplyTest({ limit: 100 });
    await reply.send("hello");
    expect(messages).toMatchInlineSnapshot(`
      [
        "hello",
      ]
    `);
  });

  it("splits long text without exceeding the limit", async () => {
    const { reply, messages } = createReplyTest({ limit: 20 });
    await reply.send("alpha beta gamma delta");
    expect(messages).toMatchInlineSnapshot(`
      [
        "alpha beta gamma",
        "delta",
      ]
    `);
  });
});
