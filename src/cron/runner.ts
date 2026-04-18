import { Temporal } from "temporal-polyfill";
import type { CronJob, CronRun, CronStore, CronTelegramTarget } from "./store.ts";
import { CronScheduler, type CronDueEvent } from "./timer.ts";

export interface CronAgentClient {
  promptSession: (options: { sessionName: string; prompt: string }) => Promise<string>;
}

export interface CronDelivery {
  sendTelegram: (target: CronTelegramTarget, text: string) => Promise<void>;
}

export type ExecuteCronJobResult =
  | {
      status: "duplicate";
    }
  | {
      status: "succeeded" | "failed";
      run: CronRun;
    };

export interface CreateCronRunnerOptions {
  store: CronStore;
  agent: CronAgentClient;
  delivery: CronDelivery;
  onRunComplete: (result: ExecuteCronJobResult) => void;
}

// TODO: rewrite to CronRunner class
export type CronRunner = ReturnType<typeof createCronRunner>;

export function createCronRunner(options: CreateCronRunnerOptions) {
  const scheduler = new CronScheduler({
    entries: [],
    onDue,
  });

  async function onDue(event: CronDueEvent): Promise<void> {
    const job = options.store.getJob(event.id);
    if (!job || !job.enabled) {
      return;
    }
    const result = await executeCronJob({
      job,
      scheduledAt: event.scheduledAt,
      store: options.store,
      agent: options.agent,
      delivery: options.delivery,
    });
    options.onRunComplete(result);
  }

  const runner = {
    start: () => {
      scheduler.start();
      runner.refresh();
    },
    refresh: () => {
      const entries = options.store
        .listJobs()
        .filter((job) => job.enabled)
        .map((job) => ({
          id: job.id,
          schedule: job.schedule,
          timezone: job.timezone,
        }));
      scheduler.updateEntries(entries);
    },
    stop: () => {
      scheduler.stop();
    },
  };
  return runner;
}

async function executeCronJob(options: {
  job: CronJob;
  scheduledAt: Temporal.Instant;
  store: Pick<CronStore, "startRun" | "finishRun">;
  agent: CronAgentClient;
  delivery: CronDelivery;
  now?: () => Temporal.Instant;
}): Promise<ExecuteCronJobResult> {
  const now = options.now ?? (() => Temporal.Now.instant());
  const scheduledAt = formatStoredInstant(options.scheduledAt);
  const startedAt = formatStoredInstant(now());
  const run = options.store.startRun({
    cronId: options.job.id,
    scheduledAt,
    startedAt,
  });
  if (!run) {
    return { status: "duplicate" };
  }

  try {
    const prompt = buildCronPrompt({
      cronId: options.job.id,
      scheduledAt: formatZonedInstant({
        instant: options.scheduledAt,
        timezone: options.job.timezone,
      }),
      startedAt,
      timezone: options.job.timezone,
      sessionName: options.job.target.sessionName,
      prompt: options.job.prompt,
    });
    const response = await options.agent.promptSession({
      sessionName: options.job.target.sessionName,
      prompt,
    });
    await options.delivery.sendTelegram(options.job.target.telegram, response);
    const nextRun = options.store.finishRun({
      cronId: options.job.id,
      scheduledAt,
      finishedAt: formatStoredInstant(now()),
      status: "succeeded",
    });
    return {
      status: "succeeded",
      run: nextRun,
    };
  } catch (error) {
    const nextRun = options.store.finishRun({
      cronId: options.job.id,
      scheduledAt,
      finishedAt: formatStoredInstant(now()),
      status: "failed",
      error: formatError(error),
    });
    return {
      status: "failed",
      run: nextRun,
    };
  }
}

export function buildCronPrompt(options: {
  cronId: string;
  scheduledAt: string;
  startedAt: string;
  timezone: string;
  sessionName: string;
  prompt: string;
}): string {
  return `\
<trigger_metadata>
trigger: cron
cron_id: ${options.cronId}
scheduled_at: ${options.scheduledAt}
started_at: ${options.startedAt}
timezone: ${options.timezone}
session_name: ${options.sessionName}
</trigger_metadata>

${options.prompt}
`;
}

function formatStoredInstant(instant: Temporal.Instant): string {
  return instant.toString({
    fractionalSecondDigits: 0,
    smallestUnit: "second",
  });
}

// TODO: move lib/utils.ts
function formatZonedInstant(options: { instant: Temporal.Instant; timezone: string }): string {
  return options.instant.toZonedDateTimeISO(options.timezone).toString({
    calendarName: "never",
    fractionalSecondDigits: 0,
    smallestUnit: "second",
    timeZoneName: "never",
  });
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
