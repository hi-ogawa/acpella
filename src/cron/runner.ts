import { Temporal } from "temporal-polyfill";
import type { CronJob, CronStore, CronTelegramTarget } from "./store.ts";
import { CronScheduler, type CronDueEvent } from "./timer.ts";

export interface CronRunnerOptions {
  store: CronStore;
  agent: {
    promptSession: (options: { sessionName: string; prompt: string }) => Promise<string>;
  };
  delivery: {
    sendTelegram: (target: CronTelegramTarget, text: string) => Promise<void>;
  };
}

export class CronRunner {
  options: CronRunnerOptions;
  scheduler: CronScheduler;

  constructor(options: CronRunnerOptions) {
    this.options = { ...options };
    this.scheduler = new CronScheduler({
      entries: [],
      onDue: this.handleDueEvent.bind(this),
    });
  }

  start() {
    this.scheduler.start();
    this.refresh();
  }

  stop() {
    this.scheduler.stop();
  }

  refresh() {
    const entries = this.options.store.listJobs().filter((job) => job.enabled);
    this.scheduler.updateEntries(entries);
  }

  async handleDueEvent(event: CronDueEvent): Promise<void> {
    const job = this.options.store.getJob(event.id);
    if (!job || !job.enabled) {
      return;
    }
    await this.executeCronJob(job, event);
  }

  async executeCronJob(job: CronJob, event: CronDueEvent) {
    const options = {
      job,
      scheduledAt: event.scheduledAt,
      store: this.options.store,
      agent: this.options.agent,
      delivery: this.options.delivery,
    };
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
      options.store.finishRun({
        cronId: options.job.id,
        scheduledAt,
        finishedAt: formatStoredInstant(now()),
        status: "succeeded",
      });
    } catch (error) {
      options.store.finishRun({
        cronId: options.job.id,
        scheduledAt,
        finishedAt: formatStoredInstant(now()),
        status: "failed",
        error: formatError(error),
      });
    }
  }
}

const now = () => Temporal.Now.instant();

function buildCronPrompt(options: {
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
