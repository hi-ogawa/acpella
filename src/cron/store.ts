import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { z } from "zod";
import { writeJsonFile } from "../lib/utils-node.ts";
import { validateCronSchedule } from "./timer.ts";

const CRON_FILE_VERSION = 1;
const CRON_STATE_FILE_VERSION = 1;

const cronIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9_-]+$/);

const telegramTargetSchema = z.object({
  chatId: z.number().int(),
  messageThreadId: z.number().int().optional(),
});

const cronTargetSchema = z.object({
  sessionName: z.string().min(1),
  telegram: telegramTargetSchema,
});

const cronJobSchema = z
  .object({
    id: cronIdSchema,
    enabled: z.boolean(),
    schedule: z.string().min(1),
    timezone: z.string().min(1),
    prompt: z.string().min(1),
    target: cronTargetSchema,
  })
  .superRefine((job, ctx) => {
    try {
      validateCronSchedule(job);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid cron schedule",
        path: ["schedule"],
      });
    }
  });

const cronJobFileSchema = z
  .object({
    version: z.literal(CRON_FILE_VERSION),
    jobs: z.record(cronIdSchema, cronJobSchema),
  })
  .superRefine((file, ctx) => {
    for (const [id, job] of Object.entries(file.jobs)) {
      if (id !== job.id) {
        ctx.addIssue({
          code: "custom",
          message: `job id does not match key: ${job.id}`,
          path: ["jobs", id, "id"],
        });
      }
    }
  });

const cronRunSchema = z.object({
  id: z.uuid(),
  scheduledAt: z.string().min(1),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1).optional(),
  status: z.enum(["running", "succeeded", "failed"]),
  error: z.string().optional(),
});

const cronStateFileSchema = z.object({
  version: z.literal(CRON_STATE_FILE_VERSION),
  runs: z.record(cronIdSchema, z.record(z.string().min(1), cronRunSchema)),
});

export type CronJobFile = z.infer<typeof cronJobFileSchema>;
export type CronStateFile = z.infer<typeof cronStateFileSchema>;
export type CronJob = z.infer<typeof cronJobSchema>;
export type CronTarget = z.infer<typeof cronTargetSchema>;
export type CronTelegramTarget = z.infer<typeof telegramTargetSchema>;
export type CronRun = z.infer<typeof cronRunSchema>;

interface CronStoreOptions {
  cronFile: string;
  cronStateFile: string;
}

export class CronStore {
  options: CronStoreOptions;
  jobFile: CronJobFile;
  stateFile: CronStateFile;

  constructor(options: CronStoreOptions) {
    this.options = { ...options };
    this.jobFile = readCronFile(options.cronFile);
    this.stateFile = readCronStateFile(options.cronStateFile);
  }

  reload() {
    this.jobFile = readCronFile(this.options.cronFile);
    this.stateFile = readCronStateFile(this.options.cronStateFile);
  }

  setJobFile(updater: (file: CronJobFile) => void): void {
    const clone = structuredClone(this.jobFile);
    updater(clone);
    this.jobFile = cronJobFileSchema.parse(clone);
    writeJsonFile(this.options.cronFile, this.jobFile);
  }

  setStateFile(updater: (file: CronStateFile) => void): void {
    const clone = structuredClone(this.stateFile);
    updater(clone);
    this.stateFile = cronStateFileSchema.parse(clone);
    writeJsonFile(this.options.cronStateFile, this.stateFile);
  }

  listJobs(): CronJob[] {
    return Object.values(this.jobFile.jobs).sort((a, b) => a.id.localeCompare(b.id));
  }

  getJob(id: string): CronJob | undefined {
    return this.jobFile.jobs[id];
  }

  addJob(job: CronJob) {
    this.setJobFile((file) => {
      if (file.jobs[job.id]) {
        throw new Error(`Cron job already exists: ${job.id}`);
      }
      file.jobs[job.id] = job;
    });
  }

  updateJob(id: string, patch: Partial<CronJob>) {
    this.setJobFile((file) => {
      if (!file.jobs[id]) {
        throw new Error(`Unknown cron job: ${id}`);
      }
      file.jobs[id] = {
        ...file.jobs[id],
        ...patch,
      };
    });
  }

  deleteJob(id: string) {
    this.setJobFile((file) => {
      if (!file.jobs[id]) {
        throw new Error(`Unknown cron job: ${id}`);
      }
      delete file.jobs[id];
    });
    this.setStateFile((file) => {
      delete file.runs[id];
    });
  }

  getRun(options: { cronId: string; scheduledAt: string }): CronRun | undefined {
    return this.stateFile.runs[options.cronId]?.[options.scheduledAt];
  }

  getLatestRun(cronId: string): CronRun | undefined {
    const runs = Object.values(this.stateFile.runs[cronId] ?? {});
    runs.sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
    return runs[0];
  }

  startRun(options: { cronId: string; scheduledAt: string; startedAt: string }): CronRun {
    let run!: CronRun;
    this.setStateFile((file) => {
      file.runs[options.cronId] ??= {};
      if (file.runs[options.cronId][options.scheduledAt]) {
        throw new Error("Cron run already exists for this schedule", {
          cause: options,
        });
      }
      run = {
        id: randomUUID(),
        scheduledAt: options.scheduledAt,
        startedAt: options.startedAt,
        status: "running",
      };
      file.runs[options.cronId][options.scheduledAt] = run;
    });
    return run;
  }

  finishRun(options: {
    cronId: string;
    scheduledAt: string;
    finishedAt: string;
    status: "succeeded" | "failed";
    error?: string;
  }): CronRun {
    let nextRun: CronRun | undefined;
    this.setStateFile((file) => {
      const run = file.runs[options.cronId]?.[options.scheduledAt];
      if (!run) {
        throw new Error(`Cannot finish missing cron run: ${options.cronId} ${options.scheduledAt}`);
      }
      run.finishedAt = options.finishedAt;
      run.status = options.status;
      run.error = options.error;
      nextRun = run;
    });
    return nextRun!;
  }
}

function readCronFile(file: string): CronJobFile {
  if (fs.existsSync(file)) {
    try {
      return cronJobFileSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (e) {
      console.error("[cron] readCronFile failed:", e);
    }
  }
  return {
    version: CRON_FILE_VERSION,
    jobs: {},
  };
}

function readCronStateFile(file: string): CronStateFile {
  if (fs.existsSync(file)) {
    try {
      return cronStateFileSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (e) {
      console.error("[cron] readCronStateFile failed:", e);
    }
  }
  return {
    version: CRON_STATE_FILE_VERSION,
    runs: {},
  };
}
