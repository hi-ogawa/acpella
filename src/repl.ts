// In-process test bot: real grammy Bot, fake transport.
// Bot receives updates via handleUpdate(), replies are captured in-memory.
// Activated from cli.ts via --repl.

import { createInterface } from "node:readline/promises";
import { Bot } from "grammy";
import type { Update, UserFromGetMe } from "grammy/types";

const botInfo: UserFromGetMe = {
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
};

export interface TestBot {
  bot: Bot;
  replies: { chatId: number; text: string }[];
  sendMessage: (
    text: string,
    opts?: { chatId?: number; userId?: number; threadId?: number },
  ) => Promise<void>;
}

export function createTestBot(options: { chatId: number }): TestBot {
  const replies: { chatId: number; text: string }[] = [];

  const bot = new Bot("test-token", { botInfo });

  // intercept outgoing API calls — capture replies instead of hitting Telegram
  bot.api.config.use(async (prev, method, payload) => {
    if (method === "sendMessage") {
      const p = payload as Record<string, unknown>;
      replies.push({ chatId: p.chat_id as number, text: p.text as string });
      return {
        ok: true as const,
        result: { message_id: 1, date: Date.now() / 1000, chat: { id: p.chat_id } },
      } as never;
    }
    return prev(method, payload);
  });

  let updateId = 1;

  return {
    bot,
    replies,
    async sendMessage(text, opts) {
      const chatId = opts?.chatId ?? options.chatId;
      const userId = opts?.userId ?? 456;
      const update: Update = {
        update_id: updateId++,
        message: {
          message_id: updateId,
          date: Math.floor(Date.now() / 1000),
          chat: { id: chatId, type: "private" as const, first_name: "Test" },
          from: { id: userId, is_bot: false, first_name: "Test" },
          text,
          ...(opts?.threadId ? { message_thread_id: opts.threadId } : {}),
        },
      };
      await bot.handleUpdate(update);
    },
  };
}

/** Start interactive REPL for a wired test bot */
export async function startTestBotRepl(testBot: TestBot): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const { replies, sendMessage } = testBot;

  try {
    while (true) {
      const text = await rl.question("> ");
      if (!text || text === "/quit") {
        break;
      }
      replies.length = 0;
      await sendMessage(text);
      for (const r of replies) {
        console.log(r.text);
      }
    }
  } catch (e) {
    if (!(e instanceof Error && e.name === "AbortError")) {
      throw e;
    }
  } finally {
    rl.close();
  }
}
