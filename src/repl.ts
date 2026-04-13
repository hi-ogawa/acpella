// In-process test bot: real grammy Bot, fake transport.
// Bot receives updates via handleUpdate(), replies are captured in-memory.
// Activated from cli.ts via --repl.

import { createInterface } from "node:readline/promises";
import { Bot, type RawApi } from "grammy";

export type TestBot = ReturnType<typeof createTestBot>;

export function createTestBot(options: { chatId: number }) {
  const bot = new Bot("test-token", {
    botInfo: {
      id: 1,
      is_bot: true,
      first_name: "TestBot",
      username: "test_bot",
      can_join_groups: true,
      can_read_all_group_messages: false,
      can_manage_bots: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: false,
      allows_users_to_create_topics: false,
    },
  });

  // intercept outgoing API calls and print replies instead of hitting Telegram
  bot.api.config.use(async (prev, method, payload) => {
    if (method === "sendMessage") {
      const args = payload as Parameters<RawApi["sendMessage"]>[0];
      console.log(args.text);
      return { ok: true } as any;
    }
    return prev(method, payload);
  });

  let updateId = 1;

  async function sendMessage(text: string) {
    const chatId = options.chatId;
    const userId = 20202020;
    await bot.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: updateId,
        date: Math.floor(Date.now() / 1000),
        chat: { id: chatId, type: "private", first_name: "Test" },
        from: { id: userId, is_bot: false, first_name: "Test" },
        text,
      },
    });
  }

  async function startRepl() {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    let cancelRequested = false;
    rl.on("SIGINT", () => {
      if (cancelRequested) {
        rl.close();
        return;
      }
      cancelRequested = true;
      void sendMessage("/cancel").finally(() => {
        cancelRequested = false;
      });
    });

    try {
      while (true) {
        const text = await rl.question("> ");
        if (!text || text === "/quit") {
          break;
        }
        await sendMessage(text);
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === "AbortError")) {
        throw e;
      }
    } finally {
      rl.close();
    }
  }

  return {
    bot,
    startRepl,
  };
}
