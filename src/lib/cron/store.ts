import { z } from "zod";
import { FileStateManager } from "../../utils/fs.ts";
import { validateCronSchedule } from "./timer.ts";

const CRON_FILE_VERSION = 1;
const CRON_STATE_FILE_VERSION = 1;
const CRON_RUN_HISTORY_LIMIT = 5;

export const cronIdSchema = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9_-]+$/);

const cronTelegramDeliveryTargetSchema = z.object({
  chatId: z.number().int(),
  messageThreadId: z.number().int().optional(),
});

const CronDeliveryTargetSchema = z
  .object({
    telegram: cronTelegramDeliveryTargetSchema.optional(),
    repl: z.boolean().optional(),
  })
  .superRefine((delivery, ctx) => {
    if (!delivery.telegram && !delivery.repl) {
      ctx.addIssue({
        code: "custom",
        message: "cron delivery target must include at least one surface",
      });
    }
  });

const cronTargetSchema = z.object({
  // how to route cron prompt to agent
  sessionName: z.string().min(1),
  // how to route agent response to external surfaces
  delivery: CronDeliveryTargetSchema,
});

const cronJobSchema = z
  .object({
    id: cronIdSchema,
    enabled: z.boolean(),
    once: z.boolean().optional(),
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

const getCronJobFileDefault = (): CronJobFile => ({
  version: CRON_FILE_VERSION,
  jobs: {},
});

const getCronStateFileDefault = (): CronStateFile => ({
  version: CRON_STATE_FILE_VERSION,
  runs: {},
});

type CronJobFile = z.infer<typeof cronJobFileSchema>;
type CronStateFile = z.infer<typeof cronStateFileSchema>;

export type CronJob = z.infer<typeof cronJobSchema>;
export type CronDeliveryTarget = z.infer<typeof CronDeliveryTargetSchema>;
export type CronRun = z.infer<typeof cronRunSchema>;
type CronRunExtra = CronRun & { cronId: string };

export class CronStore {
  options: {
    cronFile: string;
    cronStateFile: string;
  };
  jobFile: FileStateManager<CronJobFile>;
  stateFile: FileStateManager<CronStateFile>;

  constructor(options: CronStore["options"]) {
    this.options = { ...options };
    this.jobFile = new FileStateManager({
      file: options.cronFile,
      parse: (data) => cronJobFileSchema.parse(data),
      defaultValue: getCronJobFileDefault,
    });
    this.stateFile = new FileStateManager({
      file: options.cronStateFile,
      parse: (data) => cronStateFileSchema.parse(data),
      defaultValue: getCronStateFileDefault,
    });
  }

  reload() {
    const changed = this.jobFile.reload();
    if (changed) {
      this.stateFile.reload();
    }
    return changed;
  }

  listJobs(): CronJob[] {
    return Object.values(this.jobFile.state.jobs);
  }

  getJob(id: string): CronJob | undefined {
    return this.jobFile.state.jobs[id];
  }

  addJob(job: CronJob) {
    this.jobFile.set((file) => {
      if (file.jobs[job.id]) {
        throw new Error(`Cron job already exists: ${job.id}`);
      }
      file.jobs[job.id] = job;
    });
  }

  updateJob(id: string, patch: Partial<CronJob>) {
    this.jobFile.set((file) => {
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
    this.jobFile.set((file) => {
      if (!file.jobs[id]) {
        throw new Error(`Unknown cron job: ${id}`);
      }
      delete file.jobs[id];
    });
    this.stateFile.set((file) => {
      delete file.runs[id];
    });
  }

  getScheduledRun(options: { cronId: string; scheduledAt: string }): CronRun | undefined {
    return this.stateFile.state.runs[options.cronId]?.[options.scheduledAt];
  }

  getRun(id: string): CronRunExtra | undefined {
    for (const [cronId, runs] of Object.entries(this.stateFile.state.runs)) {
      for (const run of Object.values(runs)) {
        if (run.id === id) {
          return { ...run, cronId };
        }
      }
    }
  }

  getLatestRun({ cronId }: { cronId: string }): CronRun | undefined {
    const runs = Object.values(this.stateFile.state.runs[cronId] ?? {});
    runs.sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
    return runs[0];
  }

  startRun(options: { cronId: string; scheduledAt: string; startedAt: string }): CronRun {
    let run: CronRun;
    this.stateFile.set((file) => {
      file.runs[options.cronId] ??= {};
      const runs = file.runs[options.cronId];
      if (runs[options.scheduledAt]) {
        throw new Error("Cron run already exists for this schedule", {
          cause: options,
        });
      }
      run = {
        id: crypto.randomUUID(),
        scheduledAt: options.scheduledAt,
        startedAt: options.startedAt,
        status: "running",
      };
      runs[options.scheduledAt] = run;
      const oldKeys = Object.keys(runs).sort().slice(0, -CRON_RUN_HISTORY_LIMIT);
      for (const key of oldKeys) {
        const oldRun = runs[key];
        if (oldRun.status === "running") {
          continue;
        }
        delete runs[key];
      }
    });
    return run!;
  }

  updateRun(id: string, patch: Partial<Omit<CronRun, "id" | "scheduledAt">>) {
    const run = this.getRun(id);
    if (!run) {
      throw new Error(`Cannot update missing cron run: ${id}`);
    }
    this.stateFile.set((file) => {
      Object.assign(file.runs[run.cronId][run.scheduledAt], patch);
    });
  }
}
