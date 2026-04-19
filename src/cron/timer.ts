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

export interface CronSchedulerOptions {
  entries: CronTimerEntry[];
  onDue: (event: CronDueEvent) => void;
}

export class CronScheduler {
  timers: Record<string, CronTimer> = {};
  options: CronSchedulerOptions;
  stopped = true;

  constructor(options: CronSchedulerOptions) {
    this.options = { ...options };
  }

  start(): void {
    this.stopped = false;
    this.refresh();
  }

  stop(): void {
    this.stopped = true;
    this.stopTimers();
  }

  update(entries: CronTimerEntry[]): void {
    this.options.entries = entries;
    this.refresh();
  }

  refresh(): void {
    this.stopTimers();
    if (this.stopped) {
      return;
    }

    for (const entry of this.options.entries) {
      const timer = new CronTimer({
        entry,
        onDue: this.options.onDue,
      });
      timer.start();
      this.timers[entry.id] = timer;
    }
  }

  stopTimers(): void {
    for (const timer of Object.values(this.timers)) {
      timer.stop();
    }
    this.timers = {};
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
    const MAX_TIMER_DELAY_MS = 60_000;
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
