// In-process test bot: real grammy Bot, fake transport.
// Bot receives updates via handleUpdate(), replies are captured in-memory.
// Activated from index.ts via ACPELLA_TEST_BOT=1.

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

export function createTestBot(): TestBot {
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
      const chatId = opts?.chatId ?? 123;
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
      if (!text || text === "/quit") break;
      replies.length = 0;
      await sendMessage(text);
      for (const r of replies) {
        console.log(r.text);
      }
    }
  } catch {
    // Ctrl+D throws AbortError — treat as exit
  } finally {
    rl.close();
  }
}

// TODO: fix error on ctrl-D
// ~/code/personal/acpella $ pnpm repl

// > acpella@ repl /home/hiroshi/code/personal/acpella
// > ACPELLA_TEST_BOT=1 node src/index.ts

// Starting daemon (agent: codex, cwd: /home/hiroshi/code/personal/acpella, test: true)
// > node:internal/readline/interface:1343
//             this[kQuestionReject]?.(new AbortError('Aborted with Ctrl+D'));
//                                     ^

// AbortError: Aborted with Ctrl+D
//     at [_ttyWrite] (node:internal/readline/interface:1343:37)
//     at ReadStream.onkeypress (node:internal/readline/interface:284:20)
//     at ReadStream.emit (node:events:508:28)
//     at emitKeys (node:internal/readline/utils:371:14)
//     at emitKeys.next (<anonymous>)
//     at ReadStream.onData (node:internal/readline/emitKeypressEvents:64:36)
//     at ReadStream.emit (node:events:508:28)
//     at addChunk (node:internal/streams/readable:563:12)
//     at readableAddChunkPushByteMode (node:internal/streams/readable:514:3)
//     at Readable.push (node:internal/streams/readable:394:5) {
//   code: 'ABORT_ERR'
// }

// Node.js v24.14.1
//  ELIFECYCLE  Command failed with exit code 1.
