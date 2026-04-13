import fs from "node:fs";
import path from "node:path";
import { Cron } from "croner";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema definitions
// ---------------------------------------------------------------------------

export const cronEntrySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    enabled: z.boolean(),
    schedule: z.string().min(1),
    timezone: z.string().min(1),
    prompt: z.string().min(1),
    target: z.object({
      surface: z.literal("telegram"),
      chat_id: z.string().min(1),
      session_id: z.string().min(1),
    }),
    delivery: z.object({
      mode: z.literal("send_message"),
      quiet_hours: z.boolean().optional(),
    }),
  })
  .strict();

export type CronEntry = z.infer<typeof cronEntrySchema>;

const cronFileSchema = z.array(cronEntrySchema).or(
  z
    .object({
      crons: z.array(cronEntrySchema),
    })
    .strict()
    .transform((v) => v.crons),
);

const cronStateSchema = z
  .object({
    version: z.literal(1),
    jobs: z.record(
      z.string(),
      z.object({
        lastRunAt: z.string().optional(),
        nextRunAt: z.string().optional(),
        lastSuccess: z.boolean().optional(),
        lastError: z.string().optional(),
      }),
    ),
    /** Duplicate prevention: key is `${cronId}:${scheduledFor}` */
    runs: z.record(
      z.string(),
      z.object({
        firedAt: z.string(),
        success: z.boolean(),
        error: z.string().optional(),
      }),
    ),
  })
  .strict();

export type CronState = z.infer<typeof cronStateSchema>;

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

export function loadCronEntries(file: string): CronEntry[] {
  if (!fs.existsSync(file)) {
    return [];
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return cronFileSchema.parse(raw);
  } catch (e) {
    console.error("[cron] loadCronEntries failed:", e);
    return [];
  }
}

export function loadCronState(file: string): CronState {
  if (!fs.existsSync(file)) {
    return emptyCronState();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return cronStateSchema.parse(raw);
  } catch (e) {
    console.error("[cron] loadCronState failed:", e);
    return emptyCronState();
  }
}

export function saveCronState(file: string, state: CronState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}

function emptyCronState(): CronState {
  return { version: 1, jobs: {}, runs: {} };
}

// ---------------------------------------------------------------------------
// Next-run time helpers
// ---------------------------------------------------------------------------

/**
 * Returns the next scheduled run time for a cron entry, or undefined if the
 * expression is invalid or no future run exists.
 */
export function getNextRunTime(entry: Pick<CronEntry, "schedule" | "timezone">): Date | undefined {
  try {
    const job = new Cron(entry.schedule, { timezone: entry.timezone, maxRuns: 1 });
    const next = job.nextRun();
    job.stop();
    return next ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Returns the next N scheduled run times for a cron entry.
 */
export function getNextRunTimes(
  entry: Pick<CronEntry, "schedule" | "timezone">,
  count: number,
): Date[] {
  try {
    const job = new Cron(entry.schedule, { timezone: entry.timezone });
    const times: Date[] = [];
    for (let i = 0; i < count; i++) {
      const next = job.nextRun(times[times.length - 1]);
      if (!next) {
        break;
      }
      times.push(next);
    }
    job.stop();
    return times;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Duplicate-run key
// ---------------------------------------------------------------------------

export function runKey(cronId: string, scheduledFor: Date): string {
  return `${cronId}:${scheduledFor.toISOString()}`;
}
