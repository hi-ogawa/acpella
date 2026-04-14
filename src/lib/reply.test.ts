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

  it("sends system text with a system prefix", async () => {
    const { reply, messages } = createReplyTest({ limit: 100 });
    await reply.system("Status ok");
    expect(messages).toMatchInlineSnapshot(`
      [
        "[⚙️ System]
      Status ok",
      ]
    `);
  });

  it("buffers chunks until finish", async () => {
    const { reply, messages } = createReplyTest({ limit: 100 });
    await reply.write("hel");
    expect(messages).toMatchInlineSnapshot(`[]`);
    await reply.write("lo");
    expect(messages).toMatchInlineSnapshot(`[]`);
    await reply.finish();
    expect(messages).toMatchInlineSnapshot(`
      [
        "hello",
      ]
    `);
  });

  it("flushes buffered text early", async () => {
    const { reply, messages } = createReplyTest({ limit: 100 });
    await reply.write("Tool: abc");
    expect(messages).toMatchInlineSnapshot(`[]`);
    await reply.flush();
    expect(messages).toMatchInlineSnapshot(`
      [
        "Tool: abc",
      ]
    `);
    await reply.write("done");
    expect(messages).toMatchInlineSnapshot(`
      [
        "Tool: abc",
      ]
    `);
    await reply.finish();
    expect(messages).toMatchInlineSnapshot(`
      [
        "Tool: abc",
        "done",
      ]
    `);
  });

  it("flushes oversized text during write", async () => {
    const { reply, messages } = createReplyTest({ limit: 20 });
    await reply.write("alpha beta gamma delta");
    expect(messages).toMatchInlineSnapshot(`
      [
        "alpha beta gamma",
      ]
    `);
    await reply.finish();
    expect(messages).toMatchInlineSnapshot(`
      [
        "alpha beta gamma",
        "delta",
      ]
    `);
  });

  it("does not send fallback after flushed text", async () => {
    const { reply, messages } = createReplyTest({ limit: 100 });
    await reply.write("hello");
    expect(messages).toMatchInlineSnapshot(`[]`);
    await reply.flush();
    expect(messages).toMatchInlineSnapshot(`
      [
        "hello",
      ]
    `);
    await reply.finish();
    expect(messages).toMatchInlineSnapshot(`
      [
        "hello",
      ]
    `);
  });

  it("clears blank text on flush", async () => {
    const { reply, messages } = createReplyTest({ limit: 100 });
    await reply.write("   ");
    expect(messages).toMatchInlineSnapshot(`[]`);
    await reply.flush();
    expect(messages).toMatchInlineSnapshot(`[]`);
    await reply.write("hello");
    expect(messages).toMatchInlineSnapshot(`[]`);
    await reply.finish();
    expect(messages).toMatchInlineSnapshot(`
      [
        "hello",
      ]
    `);
  });

  it("sends no response fallback when reply finishes empty", async () => {
    const { reply, messages } = createReplyTest({ limit: 100 });
    await reply.finish();
    expect(messages).toMatchInlineSnapshot(`
      [
        "(no response)",
      ]
    `);
  });
});
