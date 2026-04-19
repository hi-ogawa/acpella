import { GrammyError, type Context } from "grammy";
import { PromiseLimit, TimeoutManager } from "../utils.ts";

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

type TelegramChatActionManagerOptions = {
  send: () => Promise<unknown>;
  label: string;
};

export class TelegramChatActionManager {
  options: TelegramChatActionManagerOptions;
  timeout = new TimeoutManager();
  promiseLimit = new PromiseLimit();
  stopped = true;
  retryAfterUntil = 0;

  constructor(options: TelegramChatActionManagerOptions) {
    this.options = options;
  }

  start(): void {
    this.stopped = false;
    this.schedule();
  }

  schedule(): void {
    if (this.stopped) {
      return;
    }
    const delay = Math.max(4000, this.retryAfterUntil - Date.now(), 0);
    this.timeout.set(() => void this.promiseLimit.run(() => this.pulse()), delay);
  }

  stop(): void {
    this.stopped = true;
    this.timeout.clear();
  }

  async pulse(): Promise<void> {
    if (this.stopped) {
      return;
    }
    try {
      await this.options.send();
      this.schedule();
    } catch (error) {
      const retryAfter = getTelegramRetryAfter(error);
      if (!retryAfter) {
        console.error(`${this.options.label} typing indicator failed:`, error);
        return;
      }
      console.error(
        `${this.options.label} typing indicator rate limited; pausing for ${retryAfter}s:`,
        error,
      );
      this.retryAfterUntil = Date.now() + (retryAfter + 1) * 1000;
      this.schedule();
    }
  }
}
