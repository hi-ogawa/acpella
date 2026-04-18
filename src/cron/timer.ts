import { Cron } from "croner";
import { Temporal } from "temporal-polyfill";

export interface CronTimerEntry {
  id: string;
  schedule: string;
  timezone: string;
}

export interface CronDueEvent {
  id: string;
  scheduledAt: string;
}

export interface CronTimer {
  replaceEntries: (entries: CronTimerEntry[]) => void;
  stop: () => void;
}

interface ScheduledEntry {
  entry: CronTimerEntry;
  next: CronOccurrence;
}

interface CronOccurrence {
  instant: Temporal.Instant;
  scheduledAt: string;
}

export function validateCronSchedule(options: { schedule: string; timezone: string }): void {
  const cron = createPausedCron(options);
  try {
    cron.nextRun();
  } finally {
    cron.stop();
  }
}

export function createCronTimer(options: {
  entries: CronTimerEntry[];
  onDue: (event: CronDueEvent) => void | Promise<void>;
  onError?: (error: unknown) => void;
  now?: () => Temporal.Instant;
}): CronTimer {
  const now = options.now ?? (() => Temporal.Now.instant());
  const scheduledEntries = new Map<string, ScheduledEntry>();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function replaceEntries(entries: CronTimerEntry[]): void {
    scheduledEntries.clear();
    const current = now();
    for (const entry of entries) {
      scheduledEntries.set(entry.id, {
        entry,
        next: getNextOccurrence({ ...entry, after: current }),
      });
    }
    scheduleWakeup();
  }

  function stop(): void {
    stopped = true;
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
  }

  function scheduleWakeup(): void {
    if (stopped) {
      return;
    }
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
    if (scheduledEntries.size === 0) {
      return;
    }

    const current = now();
    let nextInstant: Temporal.Instant | undefined;
    for (const scheduledEntry of scheduledEntries.values()) {
      if (!nextInstant || Temporal.Instant.compare(scheduledEntry.next.instant, nextInstant) < 0) {
        nextInstant = scheduledEntry.next.instant;
      }
    }
    if (!nextInstant) {
      return;
    }

    const delay = Math.max(0, nextInstant.epochMilliseconds - current.epochMilliseconds);
    timeout = setTimeout(runDueEntries, Math.min(delay, 60_000));
  }

  function runDueEntries(): void {
    timeout = undefined;
    if (stopped) {
      return;
    }

    const current = now();
    for (const scheduledEntry of scheduledEntries.values()) {
      if (Temporal.Instant.compare(scheduledEntry.next.instant, current) > 0) {
        continue;
      }
      const due = scheduledEntry.next;
      Promise.resolve(
        options.onDue({ id: scheduledEntry.entry.id, scheduledAt: due.scheduledAt }),
      ).catch((error: unknown) => {
        if (options.onError) {
          options.onError(error);
          return;
        }
        setTimeout(() => {
          throw error;
        }, 0);
      });
      scheduledEntry.next = getNextOccurrence({
        ...scheduledEntry.entry,
        after: due.instant,
      });
    }
    scheduleWakeup();
  }

  replaceEntries(options.entries);

  return {
    replaceEntries,
    stop,
  };
}

export function getNextOccurrence(options: {
  schedule: string;
  timezone: string;
  after: Temporal.Instant;
}): CronOccurrence {
  const cron = createPausedCron(options);
  try {
    const nextRun = cron.nextRun(new Date(options.after.epochMilliseconds));
    if (!nextRun) {
      throw new Error(`No cron occurrence found: ${options.schedule}`);
    }
    const instant = Temporal.Instant.fromEpochMilliseconds(nextRun.getTime());
    return {
      instant,
      scheduledAt: formatInstant({ instant, timezone: options.timezone }),
    };
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

function formatInstant(options: { instant: Temporal.Instant; timezone: string }): string {
  return options.instant.toZonedDateTimeISO(options.timezone).toString({
    calendarName: "never",
    fractionalSecondDigits: 0,
    smallestUnit: "second",
    timeZoneName: "never",
  });
}
