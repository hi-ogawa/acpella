import { FileWatcher } from "../../utils/fs.ts";
import { formatError, formatTime } from "../../utils/index.ts";
import type { CronJob, CronStore, CronDeliveryTarget } from "./store.ts";
import { CronScheduler, type CronDueEvent } from "./timer.ts";

interface CronRunnerOptions {
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
  watcher: FileWatcher;

  constructor(options: CronRunnerOptions) {
    this.options = { ...options };
    this.scheduler = new CronScheduler({
      entries: [],
      onDue: this.handleDueEvent.bind(this),
    });
    this.watcher = new FileWatcher({
      file: options.store.options.cronFile,
      onChange: () => {
        try {
          if (this.options.store.reload()) {
            this.refresh();
            console.log("[cron] Reloaded cron jobs from external cron file change");
          }
        } catch (error) {
          console.error(
            `[cron] Failed to reload cron jobs after external cron file change: ${formatError(error)}`,
          );
        }
      },
    });
  }

  start() {
    this.scheduler.start();
    this.watcher.start();
    this.refresh();
  }

  stop() {
    this.watcher.stop();
    this.scheduler.stop();
  }

  isRunning() {
    return !this.scheduler.stopped;
  }

  refresh() {
    const entries = this.options.store.listJobs().filter((job) => job.enabled);
    this.scheduler.update(entries);
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
    const scheduledAtTz = formatTime(event.scheduledAt, job.timezone);
    const startedAtTz = formatTime(startedAt, job.timezone);
    try {
      const prompt = buildCronPrompt({
        cronId: job.id,
        scheduledAt: scheduledAtTz,
        startedAt: startedAtTz,
        timezone: job.timezone,
        sessionName: job.target.sessionName,
        prompt: job.prompt,
      });
      const response = await this.options.agent.prompt({
        sessionName: job.target.sessionName,
        text: prompt,
      });
      if (response.trim() === "NO_REPLY") {
        console.log(`[cron] Suppressed delivery for cron '${job.id}': NO_REPLY`);
      } else {
        const message = `\
[cron: ${job.id} at ${scheduledAtTz.slice(11, 16)}]
${response}
`;
        await this.options.delivery.send({
          target: job.target.delivery,
          text: message,
        });
      }
      store.updateRun(run.id, {
        finishedAt: formatTime(Date.now()),
        status: "succeeded",
      });
    } catch (error) {
      console.error(`[cron] Failed to run cron '${job.id}':`, error);
      const errorMessage = formatError(error);
      store.updateRun(run.id, {
        finishedAt: formatTime(Date.now()),
        status: "failed",
        error: errorMessage,
      });
      try {
        await this.options.delivery.send({
          target: job.target.delivery,
          text: buildCronFailureMessage({
            cronId: job.id,
            scheduledAt: scheduledAtTz,
            startedAt: startedAtTz,
            timezone: job.timezone,
            sessionName: job.target.sessionName,
            error: errorMessage,
          }),
        });
      } catch (deliveryError) {
        console.error("[cron] Failed to deliver cron failure notification:", deliveryError);
      }
    }
    if (job.once) {
      try {
        store.updateJob(job.id, { enabled: false });
        this.refresh();
      } catch (error) {
        console.error(`[cron] Failed to disable once job '${job.id}':`, error);
      }
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

function buildCronFailureMessage(options: {
  cronId: string;
  scheduledAt: string;
  startedAt: string;
  timezone: string;
  sessionName: string;
  error: string;
}): string {
  return `\
[cron] ${options.cronId} failed

scheduled_at: ${options.scheduledAt}
started_at: ${options.startedAt}
timezone: ${options.timezone}
session_name: ${options.sessionName}

Error:
${options.error}
`;
}
