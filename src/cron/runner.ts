import { executeCronJob } from "./executor.ts";
import type { CronAgentClient, CronDelivery, ExecuteCronJobResult } from "./executor.ts";
import type { CronJob, CronStore } from "./store.ts";
import { createCronTimer } from "./timer.ts";
import type { CronTimer } from "./timer.ts";

export interface CronRunner {
  refresh: () => void;
  stop: () => void;
}

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
