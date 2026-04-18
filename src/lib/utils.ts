export function truncateString(s: string, limit: number) {
  if (s.length > limit) {
    return s.slice(0, limit - 3) + "...";
  }
  return s;
}

export function addIndent({ text, indent }: { text: string; indent: string }): string {
  return text
    .split(/\r?\n/)
    .map((line) => `${indent}${line}`)
    .join("\n");
}

export function objectPickBy<K extends PropertyKey, V>(
  o: Record<K, V>,
  f: (v: V, k: K) => boolean,
): Record<K, V> {
  return Object.fromEntries(Object.entries(o).filter(([k, v]: any[]) => f(v, k))) as any;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function formatInstant(instant: Temporal.Instant, timezone?: string): string {
  if (timezone) {
    return instant.toZonedDateTimeISO(timezone).toString({
      calendarName: "never",
      fractionalSecondDigits: 0,
      smallestUnit: "second",
      timeZoneName: "never",
    });
  }
  return instant.toString({
    fractionalSecondDigits: 0,
    smallestUnit: "second",
  });
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
