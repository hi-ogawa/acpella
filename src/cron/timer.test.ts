import { Temporal } from "temporal-polyfill";
import { expect, test } from "vitest";
import { getNextOccurrence, validateCronSchedule } from "./timer.ts";

test(validateCronSchedule, () => {
  expect(() => {
    validateCronSchedule({
      schedule: "0 0 8 * * 1-5",
      timezone: "Asia/Tokyo",
    });
  }).toThrowErrorMatchingInlineSnapshot(
    `[TypeError: CronPattern: mode '5-part' requires exactly 5 parts, but pattern '0 0 8 * * 1-5' has 6 parts.]`,
  );
  expect(() => {
    validateCronSchedule({
      schedule: "0 8 * * *",
      timezone: "No/SuchZone",
    });
  }).toThrowErrorMatchingInlineSnapshot(
    `[TypeError: CronDate: Failed to convert date to timezone 'No/SuchZone'. This may happen with invalid timezone names or dates. Original error: toTZ: Invalid timezone 'No/SuchZone' or date. Please provide a valid IANA timezone (e.g., 'America/New_York', 'Europe/Stockholm'). Original error: Invalid time zone specified: No/SuchZone]`,
  );
});

test(getNextOccurrence, () => {
  expect(
    getNextOccurrence({
      schedule: "0 8 * * 1-5",
      timezone: "Asia/Tokyo",
      after: Temporal.Instant.from("2026-04-18T00:00:00Z"),
    }),
  ).toMatchInlineSnapshot(`
    {
      "instant": "2026-04-19T23:00:00Z",
      "scheduledAt": "2026-04-20T08:00:00+09:00",
    }
  `);
  expect(
    getNextOccurrence({
      schedule: "* * * * *",
      timezone: "UTC",
      after: Temporal.Instant.from("2026-04-18T00:00:00Z"),
    }).scheduledAt,
  ).toMatchInlineSnapshot(`"2026-04-18T00:01:00+00:00"`);
});
