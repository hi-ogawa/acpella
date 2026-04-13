import path from "node:path";
import { describe, it, expect, onTestFinished, vi } from "vitest";
import { createAgentEnv, startAcpManager, type AgentSession } from "./index.ts";

// TODO: test
// - multiple updates per prompt

describe(startAcpManager, () => {
  it("basic", async () => {
    const manager = await startAcpManager({
      command: "node src/lib/test-agent.ts",
      cwd: path.join(import.meta.dirname, "../.."),
    });
    const session = await manager.newSession({
      sessionCwd: "/session-cwd",
    });
    onTestFinished(() => session.close());

    const result = session.prompt("hello");
    const updates = await arrayFromAsyncIterator(result.queue);
    expect(updates).toMatchInlineSnapshot(`
      [
        {
          "content": {
            "text": "echo: hello",
            "type": "text",
          },
          "sessionUpdate": "agent_message_chunk",
        },
      ]
    `);
  });

  it("loadSession", async () => {
    const manager = await startAcpManager({
      command: "node src/lib/test-agent.ts",
      cwd: path.join(import.meta.dirname, "../.."),
    });
    const listedSessions = await manager.listSessions();
    expect(listedSessions).toMatchInlineSnapshot(`
      {
        "sessions": [
          {
            "cwd": "/",
            "sessionId": "__testLoadSession",
          },
        ],
      }
    `);

    const session = await manager.loadSession({
      sessionId: "__testLoadSession",
      sessionCwd: "/session-cwd",
    });
    onTestFinished(() => session.close());

    const result = session.prompt("world");
    const updates = await arrayFromAsyncIterator(result.queue);
    expect(updates).toMatchInlineSnapshot(`
      [
        {
          "content": {
            "text": "echo: world",
            "type": "text",
          },
          "sessionUpdate": "agent_message_chunk",
        },
      ]
    `);

    await manager.closeSession({ sessionId: "__testLoadSession" });
  });

  it("does not pass ACPELLA service env vars to spawned agents", async () => {
    vi.stubEnv("ACPELLA_TELEGRAM_BOT_TOKEN", "secret-token");
    vi.stubEnv("OPENAI_API_KEY", "agent-key");
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });

    const manager = await startAcpManager({
      command: `${process.execPath} src/lib/test-agent.ts --report-env`,
      cwd: path.join(import.meta.dirname, "../.."),
    });
    const session = await manager.newSession({
      sessionCwd: "/session-cwd",
    });
    onTestFinished(() => session.close());

    await expect(promptText(session, "__env:ACPELLA_TELEGRAM_BOT_TOKEN")).resolves.toBe("");
    await expect(promptText(session, "__env:OPENAI_API_KEY")).resolves.toBe("agent-key");
    await expect(promptText(session, "__env:PATH")).resolves.not.toBe("");
  });
});

describe(createAgentEnv, () => {
  it("allowlists agent runtime env and strips ACPELLA vars", () => {
    expect(
      createAgentEnv({
        ACPELLA_TELEGRAM_BOT_TOKEN: "secret-token",
        HOME: "/home/alice",
        PATH: "/custom/bin:/usr/bin",
        OPENAI_API_KEY: "agent-key",
        RANDOM_SERVICE_SECRET: "nope",
        TMPDIR: "/tmp/acpella",
      }),
    ).toEqual({
      HOME: "/home/alice",
      OPENAI_API_KEY: "agent-key",
      PATH: "/custom/bin:/usr/bin",
      TMPDIR: "/tmp/acpella",
    });
  });

  it("provides a fallback PATH", () => {
    expect(createAgentEnv({}).PATH).toMatch(/\/usr\/bin/);
  });
});

async function promptText(session: AgentSession, text: string): Promise<string> {
  const result = session.prompt(text);
  const updates = await arrayFromAsyncIterator(result.queue);
  await result.promise;
  const update = updates.at(-1);
  if (update?.sessionUpdate !== "agent_message_chunk" || update.content.type !== "text") {
    throw new Error(`missing agent text for prompt: ${text}`);
  }
  return update.content.text;
}

async function arrayFromAsyncIterator<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iter) {
    result.push(item);
  }
  return result;
}
