import { GrammyError, type Context } from "grammy";

export interface TelegramChatActionLoop {
  reset: () => void;
  stop: () => void;
}

export function createTelegramChatActionLoop(options: {
  sendChatAction: () => Promise<unknown>;
  label: string;
  intervalMs?: number;
  errorLogIntervalMs?: number;
}): TelegramChatActionLoop {
  const intervalMs = options.intervalMs ?? 4000;
  const errorLogIntervalMs = options.errorLogIntervalMs ?? 60_000;

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retryAfterUntil = 0;
  let lastErrorLogAt = -errorLogIntervalMs;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function logError(message: string, error: unknown) {
    const now = Date.now();
    if (now - lastErrorLogAt < errorLogIntervalMs) {
      return;
    }
    lastErrorLogAt = now;
    console.error(`${options.label} ${message}`, error);
  }

  function schedule(delayMs: number) {
    if (stopped) {
      return;
    }
    clearTimer();
    const backoffMs = retryAfterUntil - Date.now();
    timer = setTimeout(
      () => {
        timer = undefined;
        void pulse();
      },
      Math.max(delayMs, backoffMs, 0),
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
        logError(`typing indicator rate limited; pausing for ${retryAfter}s:`, error);
      } else {
        logError("typing indicator failed:", error);
      }
    } finally {
      schedule(intervalMs);
    }
  }

  schedule(intervalMs);

  return {
    reset: () => schedule(intervalMs),
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
