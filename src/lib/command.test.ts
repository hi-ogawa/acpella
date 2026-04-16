import { describe, expect, test } from "vitest";
import { createCommandHandler, type CommandTree } from "./command.ts";

describe(createCommandHandler, () => {
  test("dispatches commands and renders generated help", async () => {
    const events: string[] = [];
    const commands: CommandTree<{ prefix: string; usage: (text: string) => Promise<void> }> = {
      ping: [
        {
          path: [],
          usage: "/ping",
          summary: "Ping the service.",
          run: async ({ prefix }) => {
            events.push(`${prefix}:pong`);
          },
        },
      ],
      config: [
        {
          path: ["show"],
          usage: "/config show",
          summary: "Show config.",
          run: async ({ prefix }) => {
            events.push(`${prefix}:config`);
          },
        },
      ],
    };
    const commandHandler = createCommandHandler({
      commands,
      onUsage: async (usage, context) => {
        await context.usage(usage);
      },
    });
    const context = {
      prefix: "test",
      usage: async (text: string) => {
        events.push(text);
      },
    };

    expect(await commandHandler.handle({ text: "hello", context })).toBe(false);
    expect(await commandHandler.handle({ text: "/missing", context })).toBe(false);
    expect(await commandHandler.handle({ text: "/ping", context })).toBe(true);
    expect(await commandHandler.handle({ text: "/config", context })).toBe(true);
    expect(await commandHandler.handle({ text: "/help", context })).toBe(true);

    expect(events).toMatchInlineSnapshot(`
      [
        "test:pong",
        "Usage: /config show",
        "Commands:
      /help - Show command help.

      /ping
        /ping - Ping the service.

      /config
        /config show - Show config.",
      ]
    `);
  });
});
