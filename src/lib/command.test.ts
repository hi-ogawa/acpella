import { describe, expect, test } from "vitest";
import { createCommandHandler, type CommandTree } from "./command.ts";

describe(createCommandHandler, () => {
  test("dispatches commands and renders generated help", async () => {
    const events: string[] = [];
    type TestContext = {
      prefix: string;
      usage: (text: string) => Promise<void>;
    };
    const commands: CommandTree<TestContext> = {
      ping: [
        {
          tokens: [],
          help: "/ping - Ping the service.",
          run: async ({ prefix }) => {
            events.push(`${prefix}:pong`);
          },
        },
      ],
      config: [
        {
          tokens: ["show"],
          help: "/config show - Show config.",
          run: async ({ prefix }) => {
            events.push(`${prefix}:config`);
          },
        },
        {
          tokens: ["set"],
          help: "/config set <value...> - Set config.",
          withArgs: true,
          run: async ({ invocation, prefix }) => {
            events.push(`${prefix}:set:${invocation.args.join(" ")}`);
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
    const context: TestContext = {
      prefix: "test",
      usage: async (text: string) => {
        events.push(text);
      },
    };

    expect(await commandHandler.handle({ text: "hello", context })).toBe(false);
    expect(await commandHandler.handle({ text: "/missing", context })).toBe(false);
    expect(await commandHandler.handle({ text: "/ping", context })).toBe(true);
    expect(await commandHandler.handle({ text: "/config", context })).toBe(true);
    expect(await commandHandler.handle({ text: "/config set theme dark", context })).toBe(true);
    expect(await commandHandler.handle({ text: "/help", context })).toBe(true);

    expect(events).toMatchInlineSnapshot(`
      [
        "test:pong",
        "Usage:
      /config show
      /config set <value...>",
        "test:set:theme dark",
        "Commands:
      /help - Show command help.

      /ping
        /ping - Ping the service.

      /config
        /config show - Show config.
        /config set <value...> - Set config.",
      ]
    `);
  });
});
