import { GrammyError, type Context } from "grammy";

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

// Telegram chat actions last 5 seconds or less, so match OpenClaw's cadence:
// delayed first cue to avoid flashing on fast replies, then 3s keepalive.
// https://core.telegram.org/bots/api#sendchataction
// See refs/openclaw/src/channels/typing.ts and refs/openclaw/src/channels/typing-lifecycle.ts.
export class TelegramChatActionManager {
  options: {
    send: () => Promise<unknown>;
    logLabel: string;
  };
  timeout?: ReturnType<typeof setTimeout>;
  interval?: ReturnType<typeof setInterval>;
  inFlight = false;
  stopped = true;
  retryAfterUntil = 0;

  constructor(options: TelegramChatActionManager["options"]) {
    this.options = options;
  }

  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.timeout = setTimeout(() => {
      this.timeout = undefined;
      void this.trySend();
      this.interval = setInterval(() => void this.trySend(), 3000);
    }, 1000);
  }

  stop(): void {
    this.stopped = true;
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  private async trySend(): Promise<void> {
    if (this.stopped || this.inFlight || Date.now() < this.retryAfterUntil) {
      return;
    }
    this.inFlight = true;
    try {
      await this.options.send();
    } catch (error) {
      const retryAfter = getTelegramRetryAfter(error);
      if (!retryAfter) {
        console.error(`${this.options.logLabel} typing indicator failed:`, error);
        this.stop();
        return;
      }
      console.error(
        `${this.options.logLabel} typing indicator rate limited; pausing for ${retryAfter}s:`,
        error,
      );
      this.retryAfterUntil = Date.now() + (retryAfter + 1) * 1000;
    } finally {
      this.inFlight = false;
    }
  }
}
