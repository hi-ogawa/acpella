const DEFAULT_SESSION_RENEW_HOUR = 4;
export type SessionRenewPolicyString = "off" | "daily" | `daily:${number}`;
export type EffectiveSessionRenewPolicy = { mode: "off" } | { mode: "daily"; atHour: number };

export interface RenewableSession {
  agentSessionId?: string;
  renew?: SessionRenewPolicyString;
  updatedAt?: number;
}

export function parseSessionRenewPolicy(value: string): EffectiveSessionRenewPolicy | undefined {
  if (value === "off") {
    return { mode: "off" };
  }
  if (value === "daily") {
    return { mode: "daily", atHour: DEFAULT_SESSION_RENEW_HOUR };
  }
  const match = /^daily:(\d+)$/.exec(value);
  if (!match) {
    return;
  }
  const atHour = Number(match[1]);
  if (!Number.isInteger(atHour) || atHour < 0 || atHour > 23) {
    return;
  }
  return { mode: "daily", atHour };
}

export function resolveSessionRenewPolicy(
  value: SessionRenewPolicyString | undefined,
): EffectiveSessionRenewPolicy {
  if (!value) {
    return { mode: "daily", atHour: DEFAULT_SESSION_RENEW_HOUR };
  }
  const policy = parseSessionRenewPolicy(value);
  if (!policy) {
    throw new Error(`Invalid session renewal policy: ${value}`);
  }
  return policy;
}

export function renderSessionRenewPolicy(
  policy: EffectiveSessionRenewPolicy,
  timezone: string,
): string {
  switch (policy.mode) {
    case "off": {
      return "off";
    }
    case "daily": {
      return `daily at ${String(policy.atHour).padStart(2, "0")}:00 ${timezone}`;
    }
  }
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
  const policy = resolveSessionRenewPolicy(options.session.renew);
  if (policy.mode === "off") {
    return false;
  }
  return (
    options.session.updatedAt <
    getSessionRenewBoundary({
      now: options.now,
      timezone: options.timezone,
      atHour: policy.atHour,
    })
  );
}
