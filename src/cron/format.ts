import { formatTime } from "../lib/utils.ts";
import type { CronJob, CronRun, CronStore } from "./store.ts";
import { getNextOccurrence } from "./timer.ts";

export function renderCronList(cronStore: CronStore): string {
  const jobs = cronStore.listJobs();
  if (jobs.length === 0) {
    return "No cron jobs.";
  }
  return jobs.map((job) => renderCronListItem(job, cronStore.getLatestRun(job.id))).join("\n");
}

function renderCronListItem(job: CronJob, latestRun: CronRun | undefined): string {
  return `\
- ${job.id} [${job.enabled ? "enabled" : "disabled"}]
  schedule: ${job.schedule}
  timezone: ${job.timezone}
  target session: ${job.target.sessionName}
  telegram target: ${formatTelegramTarget(job.target.telegram)}
  next: ${formatCronNext(job)}
  last: ${formatCronLastRun(latestRun)}
`;
}

function formatTelegramTarget(target: CronJob["target"]["telegram"]): string {
  let output = String(target.chatId);
  if (target.messageThreadId !== undefined) {
    output += `/${target.messageThreadId}`;
  }
  return output;
}

function formatCronNext(job: CronJob): string {
  try {
    return formatTime(
      getNextOccurrence({
        schedule: job.schedule,
        timezone: job.timezone,
        after: Temporal.Now.instant(),
      }),
      job.timezone,
    );
  } catch (error) {
    console.error("[cron] failed to calculate next run:", error);
    return "unknown";
  }
}

function formatCronLastRun(run: CronRun | undefined): string {
  if (!run) {
    return "none";
  }
  let output = `${run.status}, scheduled ${run.scheduledAt}`;
  if (run.finishedAt) {
    output += `, finished ${run.finishedAt}`;
  }
  if (run.error) {
    output += `, error: ${run.error}`;
  }
  return output;
}
