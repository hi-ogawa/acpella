import { Cron } from "croner";

export interface CronTimerEntry {
  id: string;
  schedule: string;
  timezone: string;
}

export interface CronDueEvent {
  id: string;
  scheduledAt: number;
}

const MAX_TIMER_DELAY_MS = 60_000;

interface ScheduledEntry {
  entry: CronTimerEntry;
  next: number;
}

export interface CronSchedulerOptions {
  entries: CronTimerEntry[];
  onDue: (event: CronDueEvent) => void;
}

export class CronScheduler {
  now = Date.now;
  scheduledEntries = new Map<string, ScheduledEntry>();
  options: CronSchedulerOptions;
  timeout?: ReturnType<typeof setTimeout>;
  stopped = true;

  constructor(options: CronSchedulerOptions) {
    this.options = { ...options };
  }

  start(): void {
    this.stopped = false;
    this.updateEntries(this.options.entries);
  }

  stop(): void {
    this.stopped = true;
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
  }

  updateEntries(entries: CronTimerEntry[]): void {
    this.options.entries = entries;
    this.scheduledEntries.clear();
    const current = this.now();
    for (const entry of entries) {
      this.scheduledEntries.set(entry.id, {
        entry,
        next: getNextOccurrence({ ...entry, after: current }),
      });
    }
    this.scheduleWakeup();
  }

  scheduleWakeup(): void {
    if (this.stopped) {
      return;
    }
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
    if (this.scheduledEntries.size === 0) {
      return;
    }

    const current = this.now();
    let nextInstant: number | undefined;
    for (const scheduledEntry of this.scheduledEntries.values()) {
      if (nextInstant === undefined || scheduledEntry.next < nextInstant) {
        nextInstant = scheduledEntry.next;
      }
    }
    if (nextInstant === undefined) {
      return;
    }

    const delay = Math.max(0, nextInstant - current);
    this.timeout = setTimeout(() => this.runDueEntries(), Math.min(delay, MAX_TIMER_DELAY_MS));
  }

  runDueEntries(): void {
    this.timeout = undefined;
    if (this.stopped) {
      return;
    }

    const current = this.now();
    for (const scheduledEntry of this.scheduledEntries.values()) {
      if (scheduledEntry.next > current) {
        continue;
      }
      const due = scheduledEntry.next;
      this.options.onDue({
        id: scheduledEntry.entry.id,
        scheduledAt: due,
      });
      scheduledEntry.next = getNextOccurrence({
        ...scheduledEntry.entry,
        after: due,
      });
    }
    this.scheduleWakeup();
  }
}

export interface CronTimerOptions {
  entry: CronTimerEntry;
  onDue: (event: CronDueEvent) => void;
}

export class CronTimer {
  options: CronTimerOptions;
  timeout?: ReturnType<typeof setTimeout>;
  scheduledAt?: number;

  constructor(options: CronTimerOptions) {
    this.options = { ...options };
  }

  start(): void {
    this.stop();
    this.scheduledAt = getNextOccurrence({
      ...this.options.entry,
      after: Date.now(),
    });
    this.armTimeout();
  }

  stop(): void {
    this.scheduledAt = undefined;
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
  }

  armTimeout(): void {
    if (this.scheduledAt === undefined) {
      return;
    }
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }

    // sleep at most MAX_TIMER_DELAY_MS to avoid clock drift.
    // early wakeup is ignored by checking due time again in handleTimeout.
    const delay = Math.min(Math.max(0, this.scheduledAt - Date.now()), MAX_TIMER_DELAY_MS);
    this.timeout = setTimeout(() => this.handleTimeout(), delay);
  }

  handleTimeout(): void {
    this.timeout = undefined;
    if (this.scheduledAt === undefined) {
      return;
    }

    const scheduledAt = this.scheduledAt;
    if (Date.now() < scheduledAt) {
      this.armTimeout();
      return;
    }

    this.options.onDue({
      id: this.options.entry.id,
      scheduledAt: scheduledAt,
    });
    this.scheduledAt = getNextOccurrence({
      ...this.options.entry,
      after: scheduledAt,
    });
    this.armTimeout();
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
  after: number;
}): number {
  const cron = createPausedCron(options);
  try {
    const nextRun = cron.nextRun(new Date(options.after));
    if (!nextRun) {
      throw new Error(`No cron occurrence found: ${options.schedule}`);
    }
    return nextRun.getTime();
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
