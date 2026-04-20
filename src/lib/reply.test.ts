import { describe, expect, it, onTestFinished, vi } from "vitest";
import { ReplyManager } from "./reply.ts";

function createReplyTest(options: { limit: number; idleTimeout?: number }) {
  const messages: string[] = [];
  const reply = new ReplyManager({
    send: async (t) => messages.push(t),
    limit: options.limit,
    idleTimeout: options.idleTimeout,
  });
  return { reply, messages };
}

describe(ReplyManager, () => {
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

  it("flushes buffered text after idle timeout", async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { reply, messages } = createReplyTest({ limit: 100, idleTimeout: 50 });
    await reply.write("hello");
    expect(messages).toMatchInlineSnapshot(`[]`);

    await vi.advanceTimersByTimeAsync(49);
    expect(messages).toMatchInlineSnapshot(`[]`);

    await vi.advanceTimersByTimeAsync(1);
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
});
