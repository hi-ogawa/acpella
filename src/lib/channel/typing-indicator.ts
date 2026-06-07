// Delay the first cue to avoid flashing on fast replies, then keep it alive every 3s.
// Inspired by OpenClaw's typing lifecycle, but intentionally smaller:
// refs/openclaw/src/channels/typing.ts and refs/openclaw/src/channels/typing-lifecycle.ts.
export class TypingIndicatorManager {
  options: {
    send: () => Promise<unknown>;
    logLabel: string;
    getRetryAfter?: (error: unknown) => number | undefined;
  };
  timeout?: ReturnType<typeof setTimeout>;
  interval?: ReturnType<typeof setInterval>;
  inFlight = false;
  stopped = true;
  retryAfterUntil = 0;

  constructor(options: TypingIndicatorManager["options"]) {
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
      const retryAfter = this.options.getRetryAfter?.(error);
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
