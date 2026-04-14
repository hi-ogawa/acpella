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

  it("buffers stream chunks until finish", async () => {
    const { reply, messages } = createReplyTest({ limit: 100 });
    const stream = reply.stream();
    await stream.write("hel");
    expect(messages).toMatchInlineSnapshot(`[]`);
    await stream.write("lo");
    expect(messages).toMatchInlineSnapshot(`[]`);
    await stream.finish();
    expect(messages).toMatchInlineSnapshot(`
      [
        "hello",
      ]
    `);
  });

  it("flushes buffered stream text early", async () => {
    const { reply, messages } = createReplyTest({ limit: 100 });
    const stream = reply.stream();
    await stream.write("Tool: abc");
    expect(messages).toMatchInlineSnapshot(`[]`);
    await stream.flush();
    expect(messages).toMatchInlineSnapshot(`
      [
        "Tool: abc",
      ]
    `);
    await stream.write("done");
    expect(messages).toMatchInlineSnapshot(`
      [
        "Tool: abc",
      ]
    `);
    await stream.finish();
    expect(messages).toMatchInlineSnapshot(`
      [
        "Tool: abc",
        "done",
      ]
    `);
  });

  it("flushes oversized stream text during write", async () => {
    const { reply, messages } = createReplyTest({ limit: 20 });
    const stream = reply.stream();
    await stream.write("alpha beta gamma delta");
    expect(messages).toMatchInlineSnapshot(`
      [
        "alpha beta gamma",
      ]
    `);
    await stream.finish();
    expect(messages).toMatchInlineSnapshot(`
      [
        "alpha beta gamma",
        "delta",
      ]
    `);
  });

  it("does not send fallback after flushed stream text", async () => {
    const { reply, messages } = createReplyTest({ limit: 100 });
    const stream = reply.stream();
    await stream.write("hello");
    expect(messages).toMatchInlineSnapshot(`[]`);
    await stream.flush();
    expect(messages).toMatchInlineSnapshot(`
      [
        "hello",
      ]
    `);
    await stream.finish();
    expect(messages).toMatchInlineSnapshot(`
      [
        "hello",
      ]
    `);
  });

  it("clears blank stream text on flush", async () => {
    const { reply, messages } = createReplyTest({ limit: 100 });
    const stream = reply.stream();
    await stream.write("   ");
    expect(messages).toMatchInlineSnapshot(`[]`);
    await stream.flush();
    expect(messages).toMatchInlineSnapshot(`[]`);
    await stream.write("hello");
    expect(messages).toMatchInlineSnapshot(`[]`);
    await stream.finish();
    expect(messages).toMatchInlineSnapshot(`
      [
        "hello",
      ]
    `);
  });

  it("sends no response fallback when stream finishes empty", async () => {
    const { reply, messages } = createReplyTest({ limit: 100 });
    const stream = reply.stream();
    await stream.finish();
    expect(messages).toMatchInlineSnapshot(`
      [
        "(no response)",
      ]
    `);
  });
});
