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

interface ParsedCronSchedule {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

interface CronField {
  any: boolean;
  values: Set<number>;
}

interface ScheduledEntry {
  entry: CronTimerEntry;
  next: CronOccurrence;
}

interface CronOccurrence {
  instant: Temporal.Instant;
  scheduledAt: string;
}

const MAX_NEXT_OCCURRENCE_MINUTES = 366 * 24 * 60 * 5;

export function validateCronSchedule(options: { schedule: string; timezone: string }): void {
  parseCronSchedule(options.schedule);
  validateTimezone(options.timezone);
}

export function getNextCronOccurrence(options: {
  schedule: string;
  timezone: string;
  after?: Temporal.Instant | Date | string | number;
}): string {
  return computeNextCronOccurrence({
    schedule: options.schedule,
    timezone: options.timezone,
    after: toInstant(options.after ?? Temporal.Now.instant()),
  }).scheduledAt;
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
      validateCronSchedule(entry);
      scheduledEntries.set(entry.id, {
        entry,
        next: computeNextCronOccurrence({ ...entry, after: current }),
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
      scheduledEntry.next = computeNextCronOccurrence({
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

function computeNextCronOccurrence(options: {
  schedule: string;
  timezone: string;
  after: Temporal.Instant;
}): CronOccurrence {
  const parsed = parseCronSchedule(options.schedule);
  validateTimezone(options.timezone);

  let cursor = nextMinute(options.after.toZonedDateTimeISO(options.timezone));
  for (let i = 0; i < MAX_NEXT_OCCURRENCE_MINUTES; i++) {
    if (matchesCronSchedule(parsed, cursor)) {
      const instant = cursor.toInstant();
      return {
        instant,
        scheduledAt: formatZonedDateTime(cursor),
      };
    }
    cursor = cursor.add({ minutes: 1 });
  }
  throw new Error(`No cron occurrence found within search window: ${options.schedule}`);
}

function parseCronSchedule(schedule: string): ParsedCronSchedule {
  const parts = schedule.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Expected five cron fields: ${schedule}`);
  }
  return {
    minute: parseCronField({ field: parts[0]!, min: 0, max: 59 }),
    hour: parseCronField({ field: parts[1]!, min: 0, max: 23 }),
    dayOfMonth: parseCronField({ field: parts[2]!, min: 1, max: 31 }),
    month: parseCronField({ field: parts[3]!, min: 1, max: 12 }),
    dayOfWeek: parseCronField({ field: parts[4]!, min: 0, max: 7, normalizeSevenToZero: true }),
  };
}

function parseCronField(options: {
  field: string;
  min: number;
  max: number;
  normalizeSevenToZero?: boolean;
}): CronField {
  const values = new Set<number>();
  for (const part of options.field.split(",")) {
    addCronFieldPart({ ...options, part, values });
  }
  return {
    any: values.size === options.max - options.min + 1,
    values,
  };
}

function addCronFieldPart(options: {
  field: string;
  part: string;
  min: number;
  max: number;
  normalizeSevenToZero?: boolean;
  values: Set<number>;
}): void {
  const stepParts = options.part.split("/");
  if (stepParts.length > 2) {
    throw new Error(`Invalid cron field: ${options.field}`);
  }
  const base = stepParts[0]!;
  const step = stepParts[1] ? parseCronNumber(stepParts[1], options.field) : 1;
  if (step < 1) {
    throw new Error(`Invalid cron step: ${options.field}`);
  }

  let start: number;
  let end: number;
  if (base === "*") {
    start = options.min;
    end = options.max;
  } else if (base.includes("-")) {
    const [startText, endText] = base.split("-");
    if (!startText || !endText) {
      throw new Error(`Invalid cron range: ${options.field}`);
    }
    start = parseCronNumber(startText, options.field);
    end = parseCronNumber(endText, options.field);
  } else {
    start = parseCronNumber(base, options.field);
    end = start;
  }

  start = normalizeCronValue({ value: start, ...options });
  end = normalizeCronValue({ value: end, ...options });
  if (start > end) {
    throw new Error(`Invalid cron range: ${options.field}`);
  }
  for (let value = start; value <= end; value += step) {
    options.values.add(normalizeCronValue({ value, ...options }));
  }
}

function parseCronNumber(value: string, field: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid cron number in field ${field}: ${value}`);
  }
  return Number(value);
}

function normalizeCronValue(options: {
  value: number;
  min: number;
  max: number;
  normalizeSevenToZero?: boolean;
}): number {
  if (options.normalizeSevenToZero && options.value === 7) {
    return 0;
  }
  if (options.value < options.min || options.value > options.max) {
    throw new Error(`Cron value out of range: ${options.value}`);
  }
  return options.value;
}

function validateTimezone(timezone: string): void {
  try {
    Temporal.Now.instant().toZonedDateTimeISO(timezone);
  } catch (error) {
    throw new Error(`Invalid timezone: ${timezone}`, { cause: error });
  }
}

function matchesCronSchedule(schedule: ParsedCronSchedule, dateTime: Temporal.ZonedDateTime) {
  if (!schedule.minute.values.has(dateTime.minute)) {
    return false;
  }
  if (!schedule.hour.values.has(dateTime.hour)) {
    return false;
  }
  if (!schedule.month.values.has(dateTime.month)) {
    return false;
  }

  const cronDayOfWeek = dateTime.dayOfWeek === 7 ? 0 : dateTime.dayOfWeek;
  const dayOfMonthMatches = schedule.dayOfMonth.values.has(dateTime.day);
  const dayOfWeekMatches = schedule.dayOfWeek.values.has(cronDayOfWeek);
  if (!schedule.dayOfMonth.any && !schedule.dayOfWeek.any) {
    return dayOfMonthMatches || dayOfWeekMatches;
  }
  return dayOfMonthMatches && dayOfWeekMatches;
}

function nextMinute(after: Temporal.ZonedDateTime): Temporal.ZonedDateTime {
  return after
    .with({ second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 })
    .add({ minutes: 1 });
}

function formatZonedDateTime(dateTime: Temporal.ZonedDateTime): string {
  return dateTime.toString({
    calendarName: "never",
    fractionalSecondDigits: 0,
    smallestUnit: "second",
    timeZoneName: "never",
  });
}

function toInstant(value: Temporal.Instant | Date | string | number): Temporal.Instant {
  if (value instanceof Temporal.Instant) {
    return value;
  }
  if (value instanceof Date) {
    return Temporal.Instant.fromEpochMilliseconds(value.getTime());
  }
  if (typeof value === "number") {
    return Temporal.Instant.fromEpochMilliseconds(value);
  }
  return Temporal.Instant.from(value);
}
