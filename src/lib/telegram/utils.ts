import { GrammyError, type Context } from "grammy";
import { PromiseLimit, TimeoutManager } from "../utils.ts";

export interface TelegramChatActionManager {
  reset: () => void;
  stop: () => void;
}

export function createTelegramChatActionManager(options: {
  sendChatAction: () => Promise<unknown>;
  label: string;
}): TelegramChatActionManager {
  const intervalMs = 4000;

  let stopped = false;
  const timer = new TimeoutManager();
  const promiseLimit = new PromiseLimit();
  let retryAfterUntil = 0;

  function schedule() {
    if (stopped) {
      return;
    }
    timer.set(() => promiseLimit.run(pulse), Math.max(intervalMs, retryAfterUntil - Date.now(), 0));
  }

  async function pulse() {
    if (stopped) {
      return;
    }
    try {
      await options.sendChatAction();
      schedule();
    } catch (error) {
      const retryAfter = getTelegramRetryAfter(error);
      if (!retryAfter) {
        console.error(`${options.label} typing indicator failed:`, error);
        return;
      }
      console.error(
        `${options.label} typing indicator rate limited; pausing for ${retryAfter}s:`,
        error,
      );
      retryAfterUntil = Date.now() + (retryAfter + 1) * 1000;
      schedule();
    }
  }

  schedule();

  return {
    reset: () => schedule(),
    stop: () => {
      stopped = true;
      timer.clear();
    },
  };
}

export function normalizeUserMention({
  text,
  username,
}: {
  text: string;
  username: string;
}): string {
  const match = text.match(/^(\/\w+)@(\w+)(?=\s|$)/);
  if (match) {
    const [prefix, command, target] = match;
    if (target.toLowerCase() === username.toLowerCase()) {
      const rest = text.slice(prefix.length);
      return `${command}${rest}`;
    }
  }
  return text;
}

export function formatTelegramSessionName(context: Context): string {
  return ["tg", context.chat?.id ?? "unknown", context.message?.message_thread_id]
    .filter(Boolean)
    .join("-");
}

export function getTelegramRetryAfter(error: unknown): number | undefined {
  if (error instanceof GrammyError && error.error_code === 429) {
    return error.parameters.retry_after;
  }
}
