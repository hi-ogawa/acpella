import { Temporal } from "temporal-polyfill";
import type { CronJob, CronRun, CronStore, CronTelegramTarget } from "./store.ts";
import { createCronTimer } from "./timer.ts";
import type { CronTimer } from "./timer.ts";

export interface CronRunner {
  refresh: () => void;
  stop: () => void;
}

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
  onRunComplete?: (result: ExecuteCronJobResult) => void;
  onError?: (error: unknown) => void;
}

export function createCronRunner(options: CreateCronRunnerOptions): CronRunner {
  let timer: CronTimer | undefined;

  function getEnabledJobs(): CronJob[] {
    return options.store.listJobs().filter((job) => job.enabled);
  }

  function refresh(): void {
    const entries = getEnabledJobs().map((job) => ({
      id: job.id,
      schedule: job.schedule,
      timezone: job.timezone,
    }));
    if (!timer) {
      timer = createCronTimer({
        entries,
        onDue,
        onError: options.onError,
      });
      return;
    }
    timer.replaceEntries(entries);
  }

  function stop(): void {
    timer?.stop();
    timer = undefined;
  }

  async function onDue(event: { id: string; scheduledAt: string }): Promise<void> {
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
    options.onRunComplete?.(result);
  }

  refresh();

  return {
    refresh,
    stop,
  };
}

async function executeCronJob(options: {
  job: CronJob;
  scheduledAt: string;
  store: Pick<CronStore, "startRun" | "finishRun">;
  agent: CronAgentClient;
  delivery: CronDelivery;
  now?: () => Temporal.Instant;
}): Promise<ExecuteCronJobResult> {
  const now = options.now ?? (() => Temporal.Now.instant());
  const startedAt = formatInstant({ instant: now(), timezone: options.job.timezone });
  const run = options.store.startRun({
    cronId: options.job.id,
    scheduledAt: options.scheduledAt,
    startedAt,
  });
  if (!run) {
    return { status: "duplicate" };
  }

  try {
    const prompt = buildCronPrompt({
      cronId: options.job.id,
      scheduledAt: options.scheduledAt,
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
      scheduledAt: options.scheduledAt,
      finishedAt: formatInstant({ instant: now(), timezone: options.job.timezone }),
      status: "succeeded",
    });
    return {
      status: "succeeded",
      run: nextRun,
    };
  } catch (error) {
    const nextRun = options.store.finishRun({
      cronId: options.job.id,
      scheduledAt: options.scheduledAt,
      finishedAt: formatInstant({ instant: now(), timezone: options.job.timezone }),
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

// TODO: move lib/utils.ts
function formatInstant(options: { instant: Temporal.Instant; timezone: string }): string {
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
