import { formatError, formatTime } from "../lib/utils.ts";
import type { CronJob, CronStore, CronDeliveryTarget } from "./store.ts";
import { CronScheduler, type CronDueEvent } from "./timer.ts";

export interface CronRunnerOptions {
  store: CronStore;
  agent: CronRunnerAgentOptions;
  delivery: {
    send: (options: { target: CronDeliveryTarget; text: string }) => Promise<void>;
  };
}

export interface CronRunnerAgentOptions {
  prompt: (options: { sessionName: string; text: string }) => Promise<string>;
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
    const scheduledAt = formatTime(event.scheduledAt);
    if (store.getScheduledRun({ cronId: job.id, scheduledAt })) {
      console.error("[cron] Cron run already exists for this schedule", {
        cronId: job.id,
        scheduledAt,
      });
      return;
    }
    const startedAt = Date.now();
    const run = store.startRun({
      cronId: job.id,
      scheduledAt,
      startedAt: formatTime(startedAt),
    });
    try {
      const prompt = buildCronPrompt({
        cronId: job.id,
        scheduledAt: formatTime(event.scheduledAt, job.timezone),
        startedAt: formatTime(startedAt, job.timezone),
        timezone: job.timezone,
        sessionName: job.target.sessionName,
        prompt: job.prompt,
      });
      const response = await this.options.agent.prompt({
        sessionName: job.target.sessionName,
        text: prompt,
      });
      await this.options.delivery.send({ target: job.target.delivery, text: response });
      store.updateRun(run.id, {
        finishedAt: formatTime(Date.now()),
        status: "succeeded",
      });
    } catch (error) {
      store.updateRun(run.id, {
        finishedAt: formatTime(Date.now()),
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
