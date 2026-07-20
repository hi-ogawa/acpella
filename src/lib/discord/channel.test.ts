import { afterEach, describe, expect, test, vi } from "vitest";
import { createHandlerTester } from "../../test/tester.ts";
import {
  createDiscordPromptNonce,
  defineDiscordCommands,
  DISCORD_PROMPT_NONCE_PREFIX,
  getDiscordSelfMessageKind,
  getDiscordTargetRejection,
} from "./channel.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("send-message command", () => {
  test("preserves multiline text and posts a deduplicated marked prompt", async () => {
    const payloads: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/channels/123")) {
          return Response.json({ guild_id: "456", type: 11, parent_id: "789" });
        }
        if (url.endsWith("/channels/123/messages")) {
          const form = init?.body as FormData;
          payloads.push(JSON.parse(String(form.get("payload_json"))));
          return Response.json({ id: "999" });
        }
        throw new Error(`Unexpected Discord request: ${url}`);
      }),
    );
    const tester = await createHandlerTester({
      extraCommands: {
        discord: defineDiscordCommands({
          token: "test-token",
          allowedGuildIds: ["456"],
          allowedChannelIds: ["789"],
        }),
      },
    });

    await expect(
      tester
        .createSession("source")
        .request("/discord send-message 123 -- first line\n\nsecond -- later"),
    ).resolves.toMatchInlineSnapshot(`
      "[⚙️ System]
      Sent prompt to Discord session.
      session: discord:123
      url: https://discord.com/channels/456/123/999"
    `);
    expect(payloads).toEqual([
      {
        content: "first line\n\nsecond -- later",
        nonce: expect.stringMatching(/^acpella-prompt:[0-9a-f]{10}$/),
        enforce_nonce: true,
      },
    ]);
  });

  test("rejects a disallowed target before posting", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ guild_id: "456", type: 0, parent_id: null }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const tester = await createHandlerTester({
      extraCommands: {
        discord: defineDiscordCommands({
          token: "test-token",
          allowedGuildIds: ["456"],
          allowedChannelIds: ["789"],
        }),
      },
    });

    await expect(
      tester.createSession("source").request("/discord send-message 123 -- follow up"),
    ).rejects.toThrow("Channel is not allowed: 123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("shows help and rejects malformed prompt arguments before REST calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const tester = await createHandlerTester({
      extraCommands: {
        discord: defineDiscordCommands({
          token: "test-token",
          allowedGuildIds: ["456"],
          allowedChannelIds: [],
        }),
      },
    });
    const session = tester.createSession("source");

    await expect(session.request("/discord")).resolves.toContain(
      "/discord send-message <channel-id> -- <text>",
    );
    await expect(session.request("/discord send-message 123")).rejects.toThrow(
      "Missing `-- <text>`",
    );
    await expect(session.request("/discord send-message abc -- text")).rejects.toThrow(
      "Invalid channel id: abc",
    );
    await expect(session.request("/discord send-message 123 extra -- text")).rejects.toThrow(
      "Invalid arguments: 123 extra",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

test("prompt nonces use the reserved prefix with unique random suffixes", () => {
  const first = createDiscordPromptNonce();
  const second = createDiscordPromptNonce();
  expect(first).toMatch(/^acpella-prompt:[0-9a-f]{10}$/);
  expect(first.length).toBeLessThanOrEqual(25);
  expect(second).not.toBe(first);
});

test("classifies only trusted self starters and marked self prompts", () => {
  const base = {
    authorId: "bot",
    botUserId: "bot",
    messageId: "message",
    channelId: "channel",
  };
  expect(getDiscordSelfMessageKind({ ...base, messageId: "channel" })).toBe("starter");
  expect(getDiscordSelfMessageKind({ ...base, nonce: `${DISCORD_PROMPT_NONCE_PREFIX}abc` })).toBe(
    "prompt",
  );
  expect(getDiscordSelfMessageKind({ ...base, nonce: "unmarked" })).toBeUndefined();
  expect(getDiscordSelfMessageKind({ ...base, nonce: null })).toBeUndefined();
  expect(
    getDiscordSelfMessageKind({
      ...base,
      authorId: "other-bot",
      nonce: `${DISCORD_PROMPT_NONCE_PREFIX}abc`,
    }),
  ).toBeUndefined();
});

test("allows configured guilds, channels, and child threads", () => {
  const base = {
    guildId: "guild",
    channelId: "channel",
    allowedGuildIds: ["guild"],
    allowedChannelIds: ["channel"],
  };
  expect(getDiscordTargetRejection(base)).toBeUndefined();
  expect(getDiscordTargetRejection({ ...base, allowedChannelIds: [] })).toBeUndefined();
  expect(
    getDiscordTargetRejection({
      ...base,
      channelId: "thread",
      parentChannelId: "channel",
    }),
  ).toBeUndefined();
  expect(getDiscordTargetRejection({ ...base, guildId: "other" })).toBe("guild");
  expect(getDiscordTargetRejection({ ...base, channelId: "other" })).toBe("channel");
});

test("a marked follow-up uses normal first-prompt and busy-session handling", async () => {
  const selfMessageKind = getDiscordSelfMessageKind({
    authorId: "bot",
    botUserId: "bot",
    messageId: "message",
    channelId: "123",
    nonce: `${DISCORD_PROMPT_NONCE_PREFIX}abc`,
  });
  expect(selfMessageKind).toBe("prompt");

  const tester = await createHandlerTester();
  const session = tester.createSession("discord:123");
  expect(await session.request("first prompt")).toBe("echo: first prompt");

  const active = session.requestStream("__wait_cancel__");
  await expect.poll(() => active.replies).toEqual(["cancel-before"]);
  const queued = session.requestStream("follow up");
  expect(queued.replies).toEqual([]);

  await session.request("/cancel");
  await active.promise;
  await queued.promise;
  expect(queued.replies).toEqual(["echo: follow up"]);
});
