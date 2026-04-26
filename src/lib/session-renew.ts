const DEFAULT_SESSION_RENEW_HOUR = 4;
export type SessionRenewPolicy = { mode: "daily"; atHour: number };

export interface RenewableSession {
  agentSessionId?: string;
  renew?: SessionRenewPolicy;
  updatedAt?: number;
}

export function parseSessionRenewPolicy(value: string): SessionRenewPolicy {
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

function getSessionRenewBoundary(options: {
  now: number;
  timezone: string;
  atHour: number;
}): number {
  const instant = Temporal.Instant.fromEpochMilliseconds(options.now);
  const zoned = instant.toZonedDateTimeISO(options.timezone);
  let boundary = Temporal.ZonedDateTime.from({
    timeZone: options.timezone,
    year: zoned.year,
    month: zoned.month,
    day: zoned.day,
    hour: options.atHour,
  });
  if (boundary.epochMilliseconds > options.now) {
    boundary = boundary.subtract({ days: 1 });
  }
  return boundary.epochMilliseconds;
}

export function shouldRenewSession(options: {
  session: RenewableSession;
  now: number;
  timezone: string;
}): boolean {
  if (!options.session.agentSessionId || options.session.updatedAt === undefined) {
    return false;
  }
  if (!options.session.renew) {
    return false;
  }
  return (
    options.session.updatedAt <
    getSessionRenewBoundary({
      now: options.now,
      timezone: options.timezone,
      atHour: options.session.renew.atHour,
    })
  );
}
