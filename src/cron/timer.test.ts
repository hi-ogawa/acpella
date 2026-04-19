import { expect, test, vi } from "vitest";
import { formatTime } from "../lib/utils.ts";
import {
  CronTimer,
  getNextCronSchedule,
  validateCronSchedule,
  type CronDueEvent,
} from "./timer.ts";

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

test(getNextCronSchedule, () => {
  expect(
    formatTime(
      getNextCronSchedule({
        schedule: "0 8 * * 1-5",
        timezone: "Asia/Tokyo",
        after: Date.parse("2026-04-18T00:00:00Z"),
      }),
    ),
  ).toMatchInlineSnapshot(`"2026-04-19T23:00:00Z"`);
  expect(
    formatTime(
      getNextCronSchedule({
        schedule: "* * * * *",
        timezone: "UTC",
        after: Date.parse("2026-04-18T00:00:00Z"),
      }),
    ),
  ).toMatchInlineSnapshot(`"2026-04-18T00:01:00Z"`);
});

test(CronTimer, ({ onTestFinished }) => {
  vi.useFakeTimers({
    now: Date.parse("2026-04-18T00:03:00Z"),
  });
  onTestFinished(() => {
    vi.useRealTimers();
  });

  const events: CronDueEvent[] = [];
  const timer = new CronTimer({
    entry: {
      id: "test",
      schedule: "* * * * *",
      timezone: "UTC",
    },
    onDue: (event) => events.push(event),
  });
  onTestFinished(() => {
    timer.stop();
  });
  timer.scheduledAt = Date.parse("2026-04-18T00:01:00Z");

  timer.handleTimeout();

  expect(events).toEqual([
    {
      id: "test",
      scheduledAt: Date.parse("2026-04-18T00:01:00Z"),
    },
  ]);
  expect(timer.scheduledAt).toBe(Date.parse("2026-04-18T00:02:00Z"));
});
