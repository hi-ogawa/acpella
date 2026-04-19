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

interface ScheduledEntry {
  entry: CronTimerEntry;
  next: Temporal.Instant;
}

export interface CronSchedulerOptions {
  entries: CronTimerEntry[];
  onDue: (event: CronDueEvent) => void;
}

export class CronScheduler {
  now = () => Temporal.Now.instant();
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
    let nextInstant: Temporal.Instant | undefined;
    for (const scheduledEntry of this.scheduledEntries.values()) {
      if (!nextInstant || Temporal.Instant.compare(scheduledEntry.next, nextInstant) < 0) {
        nextInstant = scheduledEntry.next;
      }
    }
    if (!nextInstant) {
      return;
    }

    const delay = Math.max(0, nextInstant.epochMilliseconds - current.epochMilliseconds);
    this.timeout = setTimeout(() => this.runDueEntries(), Math.min(delay, 60_000));
  }

  runDueEntries(): void {
    this.timeout = undefined;
    if (this.stopped) {
      return;
    }

    const current = this.now();
    for (const scheduledEntry of this.scheduledEntries.values()) {
      if (Temporal.Instant.compare(scheduledEntry.next, current) > 0) {
        continue;
      }
      const due = scheduledEntry.next;
      this.options.onDue({
        id: scheduledEntry.entry.id,
        scheduledAt: due.epochMilliseconds,
      });
      scheduledEntry.next = getNextOccurrence({
        ...scheduledEntry.entry,
        after: due,
      });
    }
    this.scheduleWakeup();
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
