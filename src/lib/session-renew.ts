import { z } from "zod";

const DEFAULT_SESSION_RENEW_HOUR = 4;

export const sessionRenewPolicySchema = z.object({
  mode: z.literal("daily"),
  atHour: z.number().int().min(0).max(23),
});

type SessionRenewPolicy = z.infer<typeof sessionRenewPolicySchema>;

export function parseSessionRenewPolicy(value: string): SessionRenewPolicy | undefined {
  if (value === "off") {
    return undefined;
  }
  if (value === "daily") {
    return { mode: "daily", atHour: DEFAULT_SESSION_RENEW_HOUR };
  }
  const match = /^daily:(\d+)$/.exec(value);
  if (match) {
    const atHour = Number(match[1]);
    if (Number.isInteger(atHour) && atHour >= 0 && atHour <= 23) {
      return { mode: "daily", atHour };
    }
  }
  throw new Error(`Invalid session renewal policy: ${value}`);
}

export function renderSessionRenewPolicy(options: {
  policy?: SessionRenewPolicy;
  timezone: string;
}): string {
  if (!options.policy) {
    return "off";
  }
  return `daily at ${String(options.policy.atHour).padStart(2, "0")}:00 ${options.timezone}`;
}

export function shouldRenewSession({
  updatedAt,
  renew,
  now,
  timezone,
}: {
  updatedAt?: number;
  renew?: SessionRenewPolicy;
  now: number;
  timezone: string;
}): boolean {
  if (updatedAt && renew) {
    const currentPeriodStart = getRenewalPeriodStartMs({
      time: now,
      timezone,
      atHour: renew.atHour,
    });
    return updatedAt < currentPeriodStart;
  }
  return false;
}

function getRenewalPeriodStartMs(options: {
  time: number;
  timezone: string;
  atHour: number;
}): number {
  const instant = Temporal.Instant.fromEpochMilliseconds(options.time);
  const zoned = instant.toZonedDateTimeISO(options.timezone);
  let periodStart = Temporal.ZonedDateTime.from({
    timeZone: options.timezone,
    year: zoned.year,
    month: zoned.month,
    day: zoned.day,
    hour: options.atHour,
  });
  if (periodStart.epochMilliseconds > options.time) {
    periodStart = periodStart.subtract({ days: 1 });
  }
  return periodStart.epochMilliseconds;
}
