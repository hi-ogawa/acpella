import { Cron } from "croner";
import { Temporal } from "temporal-polyfill";

export interface CronTimerEntry {
  id: string;
  schedule: string;
  timezone: string;
}

export interface CronDueEvent {
  id: string;
  scheduledAt: Temporal.Instant;
}

interface ScheduledEntry {
  entry: CronTimerEntry;
  next: Temporal.Instant;
}

export interface CronSchedulerOptions {
  entries: CronTimerEntry[];
  onDue: (event: CronDueEvent) => void | Promise<void>;
  onError?: (error: unknown) => void;
  now?: () => Temporal.Instant;
}

export class CronScheduler {
  readonly #now: () => Temporal.Instant;
  readonly #scheduledEntries = new Map<string, ScheduledEntry>();
  readonly #options: CronSchedulerOptions;
  #entries: CronTimerEntry[];
  #timeout: ReturnType<typeof setTimeout> | undefined;
  #stopped = true;

  constructor(options: CronSchedulerOptions) {
    this.#options = options;
    this.#entries = options.entries;
    this.#now = options.now ?? (() => Temporal.Now.instant());
  }

  start(): void {
    this.#stopped = false;
    this.updateEntries(this.#entries);
  }

  stop(): void {
    this.#stopped = true;
    if (this.#timeout) {
      clearTimeout(this.#timeout);
      this.#timeout = undefined;
    }
  }

  updateEntries(entries: CronTimerEntry[]): void {
    this.#entries = entries;
    this.#scheduledEntries.clear();
    const current = this.#now();
    for (const entry of entries) {
      this.#scheduledEntries.set(entry.id, {
        entry,
        next: getNextOccurrence({ ...entry, after: current }),
      });
    }
    this.#scheduleWakeup();
  }

  #scheduleWakeup(): void {
    if (this.#stopped) {
      return;
    }
    if (this.#timeout) {
      clearTimeout(this.#timeout);
      this.#timeout = undefined;
    }
    if (this.#scheduledEntries.size === 0) {
      return;
    }

    const current = this.#now();
    let nextInstant: Temporal.Instant | undefined;
    for (const scheduledEntry of this.#scheduledEntries.values()) {
      if (!nextInstant || Temporal.Instant.compare(scheduledEntry.next, nextInstant) < 0) {
        nextInstant = scheduledEntry.next;
      }
    }
    if (!nextInstant) {
      return;
    }

    const delay = Math.max(0, nextInstant.epochMilliseconds - current.epochMilliseconds);
    this.#timeout = setTimeout(() => this.#runDueEntries(), Math.min(delay, 60_000));
  }

  #runDueEntries(): void {
    this.#timeout = undefined;
    if (this.#stopped) {
      return;
    }

    const current = this.#now();
    for (const scheduledEntry of this.#scheduledEntries.values()) {
      if (Temporal.Instant.compare(scheduledEntry.next, current) > 0) {
        continue;
      }
      const due = scheduledEntry.next;
      Promise.resolve(this.#options.onDue({ id: scheduledEntry.entry.id, scheduledAt: due })).catch(
        (error: unknown) => {
          if (this.#options.onError) {
            this.#options.onError(error);
            return;
          }
          setTimeout(() => {
            throw error;
          }, 0);
        },
      );
      scheduledEntry.next = getNextOccurrence({
        ...scheduledEntry.entry,
        after: due,
      });
    }
    this.#scheduleWakeup();
  }
}

// borrow croner for cron pattern logic

export function validateCronSchedule(options: { schedule: string; timezone: string }): void {
  const cron = createPausedCron(options);
  try {
    cron.nextRun();
  } finally {
    cron.stop();
  }
}

export function getNextOccurrence(options: {
  schedule: string;
  timezone: string;
  after: Temporal.Instant;
}): Temporal.Instant {
  const cron = createPausedCron(options);
  try {
    const nextRun = cron.nextRun(new Date(options.after.epochMilliseconds));
    if (!nextRun) {
      throw new Error(`No cron occurrence found: ${options.schedule}`);
    }
    return Temporal.Instant.fromEpochMilliseconds(nextRun.getTime());
  } finally {
    cron.stop();
  }
}

function createPausedCron(options: { schedule: string; timezone: string }): Cron {
  return new Cron(options.schedule, {
    timezone: options.timezone,
    paused: true,
    mode: "5-part",
  });
}
