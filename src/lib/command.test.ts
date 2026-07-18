import { describe, expect, test } from "vitest";
import { CommandHandler, type CommandTree } from "./command.ts";

describe(CommandHandler, () => {
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
          usage: "/ping",
          description: "Ping the service.",
          run: async ({ prefix }) => {
            events.push(`${prefix}:pong`);
          },
        },
      ],
      config: [
        {
          tokens: ["show"],
          usage: "/config show",
          description: "Show config.",
          run: async ({ prefix }) => {
            events.push(`${prefix}:config`);
          },
        },
        {
          tokens: ["set"],
          usage: "/config set <value...>",
          description: "Set config.",
          withArgs: true,
          run: async ({ args, prefix }) => {
            events.push(`${prefix}:set:${args.join(" ")}`);
          },
        },
      ],
      test: [
        {
          tokens: [],
          usage: "/test <value...>",
          description: "Run test command.",
          withArgs: true,
          run: async ({ usage }) => {
            events.push(usage);
          },
        },
      ],
    };
    const commandHandler = new CommandHandler({
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
    expect(await commandHandler.handle({ text: "/config help", context })).toBe(true);
    expect(await commandHandler.handle({ text: "/config missing", context })).toBe(true);
    expect(await commandHandler.handle({ text: "/config set theme dark", context })).toBe(true);
    expect(await commandHandler.handle({ text: "/test hello", context })).toBe(true);
    expect(await commandHandler.handle({ text: "/help", context })).toBe(true);

    expect(events).toMatchInlineSnapshot(`
      [
        "test:pong",
        "/config
        /config show - Show config.
        /config set <value...> - Set config.
      ",
        "/config
        /config show - Show config.
        /config set <value...> - Set config.
      ",
        "/config
        /config show - Show config.
        /config set <value...> - Set config.
      ",
        "test:set:theme dark",
        "Usage: /test <value...>",
        "Commands:
      /help - Show command help.

      /ping
        /ping - Ping the service.

      /config
        /config show - Show config.
        /config set <value...> - Set config.

      /test
        /test <value...> - Run test command.

      ",
      ]
    `);
  });

  test("exposes full args and separator-aware args to every command", async () => {
    type Run = { args: string[]; splitArgs: { head: string[]; body?: string } };
    const bodyRuns: Run[] = [];
    const regularRuns: Run[] = [];
    let exactRuns = 0;
    const usages: string[] = [];
    const commandHandler = new CommandHandler({
      commands: {
        body: [
          {
            tokens: ["run"],
            usage: "/body run <title...> [-- <body>]",
            description: "Run with a body.",
            withArgs: true,
            run: async ({ args, splitArgs }) => {
              bodyRuns.push({ args, splitArgs });
            },
          },
        ],
        regular: [
          {
            tokens: [],
            usage: "/regular <args...>",
            description: "Run with regular arguments.",
            withArgs: true,
            run: async ({ args, splitArgs }) => {
              regularRuns.push({ args, splitArgs });
            },
          },
        ],
        exact: [
          {
            tokens: [],
            usage: "/exact",
            description: "Run without arguments.",
            run: async () => {
              exactRuns++;
            },
          },
        ],
      },
      onUsage: async (usage) => {
        usages.push(usage);
      },
    });

    await commandHandler.handle({
      text: "/body run foo--bar title -- first\n\nsecond -- later",
      context: {},
    });
    await commandHandler.handle({ text: "/body run title", context: {} });
    await commandHandler.handle({ text: "/body run title --", context: {} });
    await commandHandler.handle({ text: "/regular one -- two", context: {} });
    await commandHandler.handle({ text: "/exact -- unexpected", context: {} });

    expect(bodyRuns).toEqual([
      {
        args: ["foo--bar", "title", "--", "first", "second", "--", "later"],
        splitArgs: {
          head: ["foo--bar", "title"],
          body: "first\n\nsecond -- later",
        },
      },
      { args: ["title"], splitArgs: { head: ["title"] } },
      { args: ["title", "--"], splitArgs: { head: ["title"], body: "" } },
    ]);
    expect(regularRuns).toEqual([
      {
        args: ["one", "--", "two"],
        splitArgs: { head: ["one"], body: "two" },
      },
    ]);
    expect(exactRuns).toBe(0);
    expect(usages).toEqual(["/exact\n  /exact - Run without arguments.\n"]);
  });
});
