import { formatError, formatInstant } from "../lib/utils.ts";
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
    const { store } = this.options;
    const scheduledAt = formatInstant(event.scheduledAt);
    if (store.getRun({ cronId: job.id, scheduledAt })) {
      // TODO: warn?
      return;
    }
    const startedAt = Temporal.Now.instant();
    store.startRun({
      cronId: job.id,
      scheduledAt,
      startedAt: formatInstant(startedAt),
    });
    try {
      const prompt = buildCronPrompt({
        cronId: job.id,
        scheduledAt: formatInstant(event.scheduledAt, job.timezone),
        startedAt: formatInstant(startedAt, job.timezone),
        timezone: job.timezone,
        sessionName: job.target.sessionName,
        prompt: job.prompt,
      });
      const response = await this.options.agent.promptSession({
        sessionName: job.target.sessionName,
        prompt,
      });
      await this.options.delivery.sendTelegram(job.target.telegram, response);
      store.finishRun({
        cronId: job.id,
        scheduledAt,
        finishedAt: formatInstant(Temporal.Now.instant()),
        status: "succeeded",
      });
    } catch (error) {
      store.finishRun({
        cronId: job.id,
        scheduledAt,
        finishedAt: formatInstant(Temporal.Now.instant()),
        status: "failed",
        error: formatError(error),
      });
    }
  }
}

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
