import { expect, test } from "vitest";
import {
  formatDiscordConversationMetadata,
  formatDiscordSessionName,
  formatDiscordThinking,
  parseDiscordSessionName,
} from "./utils.ts";

test("discord session name", () => {
  expect(formatDiscordSessionName("123")).toBe("discord:123");
  expect(parseDiscordSessionName("discord:123")).toEqual({ channelId: "123" });
  expect(parseDiscordSessionName("discord:abc")).toBe(undefined);
});

test("discord metadata", () => {
  expect(
    formatDiscordConversationMetadata({
      channelId: "123",
      isDirectMessage: true,
    }),
  ).toBe("discord:dm:123");
  expect(
    formatDiscordConversationMetadata({
      guildId: "456",
      channelId: "123",
      isDirectMessage: false,
    }),
  ).toBe("discord:guild:456:channel:123");
});

test("discord thinking", () => {
  expect(formatDiscordThinking("Inspect the source")).toMatchInlineSnapshot(`
    "> **Thinking**
    > Inspect the source"
  `);
  expect(formatDiscordThinking("Inspect the source\n\nThen run tests")).toMatchInlineSnapshot(`
    "> **Thinking**
    > Inspect the source
    >
    > Then run tests"
  `);
});

test("discord thinking removes empty HTML comment lines", () => {
  expect(formatDiscordThinking("Inspect the source\n\n<!-- -->")).toMatchInlineSnapshot(`
    "> **Thinking**
    > Inspect the source"
  `);
  expect(formatDiscordThinking("  <!--   -->  ")).toBe("");
  expect(formatDiscordThinking("Keep <!-- --> inline")).toMatchInlineSnapshot(`
    "> **Thinking**
    > Keep <!-- --> inline"
  `);
});
