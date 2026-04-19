import { GrammyError, type Context } from "grammy";

export interface TelegramChatActionLoop {
  reset: () => void;
  stop: () => void;
}

export function createTelegramChatActionLoop(options: {
  sendChatAction: () => Promise<unknown>;
  label: string;
  intervalMs?: number;
}): TelegramChatActionLoop {
  const intervalMs = options.intervalMs ?? 4000;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryAfterUntil = 0;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function schedule() {
    if (stopped) {
      return;
    }
    clearTimer();
    timer = setTimeout(
      () => {
        timer = undefined;
        void pulse();
      },
      Math.max(intervalMs, retryAfterUntil - Date.now(), 0),
    );
  }

  async function pulse() {
    if (stopped) {
      return;
    }
    try {
      await options.sendChatAction();
    } catch (error) {
      const retryAfter = getTelegramRetryAfter(error);
      if (retryAfter) {
        retryAfterUntil = Date.now() + (retryAfter + 1) * 1000;
      }
    } finally {
      schedule();
    }
  }

  schedule();

  return {
    reset: () => schedule(),
    stop: () => {
      stopped = true;
      clearTimer();
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
