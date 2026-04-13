import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getNextRunTime,
  getNextRunTimes,
  loadCronEntries,
  loadCronState,
  runKey,
  saveCronState,
  type CronEntry,
} from "./cron.ts";

const exampleEntry: CronEntry = {
  id: "daily-routine-morning",
  name: "Morning routine",
  enabled: true,
  schedule: "0 8 * * *",
  timezone: "Asia/Tokyo",
  prompt: "Follow the morning step in the daily-routine skill.",
  target: {
    surface: "telegram",
    chat_id: "123456",
    session_id: "test-session-id",
  },
  delivery: {
    mode: "send_message",
    quiet_hours: true,
  },
};

describe("loadCronEntries", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(import.meta.dirname, ".tmp-cron-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty array when file does not exist", () => {
    const file = path.join(tmpDir, "nonexistent.json");
    expect(loadCronEntries(file)).toEqual([]);
  });

  it("loads a valid array of cron entries", () => {
    const file = path.join(tmpDir, "cron.json");
    fs.writeFileSync(file, JSON.stringify([exampleEntry]));
    const entries = loadCronEntries(file);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe("daily-routine-morning");
  });

  it("loads entries from {crons: [...]} wrapper format", () => {
    const file = path.join(tmpDir, "cron.json");
    fs.writeFileSync(file, JSON.stringify({ crons: [exampleEntry] }));
    const entries = loadCronEntries(file);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe("daily-routine-morning");
  });

  it("returns empty array on invalid JSON", () => {
    const file = path.join(tmpDir, "cron.json");
    fs.writeFileSync(file, "not json");
    expect(loadCronEntries(file)).toEqual([]);
  });

  it("returns empty array on schema mismatch", () => {
    const file = path.join(tmpDir, "cron.json");
    fs.writeFileSync(file, JSON.stringify([{ id: "bad" }]));
    expect(loadCronEntries(file)).toEqual([]);
  });
});

describe("loadCronState and saveCronState", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(import.meta.dirname, ".tmp-cron-state-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns empty state when file does not exist", () => {
    const file = path.join(tmpDir, "cron-state.json");
    const state = loadCronState(file);
    expect(state.version).toBe(1);
    expect(state.jobs).toEqual({});
    expect(state.runs).toEqual({});
  });

  it("round-trips state through save and load", () => {
    const file = path.join(tmpDir, "cron-state.json");
    const firedAt = new Date("2026-04-13T08:00:02.000Z");
    saveCronState(file, {
      version: 1,
      jobs: {
        "daily-routine-morning": {
          lastRunAt: firedAt.toISOString(),
          lastSuccess: true,
        },
      },
      runs: {
        "daily-routine-morning:2026-04-13T08:00:00.000Z": {
          firedAt: firedAt.toISOString(),
          success: true,
        },
      },
    });
    const loaded = loadCronState(file);
    expect(loaded.jobs["daily-routine-morning"]?.lastSuccess).toBe(true);
    expect(loaded.runs["daily-routine-morning:2026-04-13T08:00:00.000Z"]?.success).toBe(true);
  });

  it("creates parent directories if needed", () => {
    const file = path.join(tmpDir, "nested", "dir", "cron-state.json");
    saveCronState(file, { version: 1, jobs: {}, runs: {} });
    expect(fs.existsSync(file)).toBe(true);
  });
});

describe("runKey", () => {
  it("formats a stable key from cronId and scheduledFor", () => {
    const date = new Date("2026-04-13T08:00:00.000Z");
    expect(runKey("daily-routine-morning", date)).toBe(
      "daily-routine-morning:2026-04-13T08:00:00.000Z",
    );
  });
});

describe("getNextRunTime", () => {
  it("returns a future date for a valid schedule", () => {
    const next = getNextRunTime({ schedule: "0 8 * * *", timezone: "Asia/Tokyo" });
    expect(next).toBeInstanceOf(Date);
    expect(next!.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns undefined for an invalid schedule expression", () => {
    const next = getNextRunTime({ schedule: "invalid", timezone: "Asia/Tokyo" });
    expect(next).toBeUndefined();
  });

  it("returns undefined for an invalid timezone", () => {
    const next = getNextRunTime({ schedule: "0 8 * * *", timezone: "Not/A/Timezone" });
    expect(next).toBeUndefined();
  });
});

describe("getNextRunTimes", () => {
  it("returns the requested number of future run times", () => {
    const times = getNextRunTimes({ schedule: "0 * * * *", timezone: "UTC" }, 3);
    expect(times).toHaveLength(3);
    for (const t of times) {
      expect(t).toBeInstanceOf(Date);
    }
    // Times should be in ascending order
    expect(times[1]!.getTime()).toBeGreaterThan(times[0]!.getTime());
    expect(times[2]!.getTime()).toBeGreaterThan(times[1]!.getTime());
  });

  it("returns empty array for invalid schedule", () => {
    const times = getNextRunTimes({ schedule: "bad", timezone: "UTC" }, 3);
    expect(times).toEqual([]);
  });
});
