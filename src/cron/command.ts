import { formatTime } from "../lib/utils.ts";
import { type CronJob, type CronRun, type CronStore, cronIdSchema } from "./store.ts";
import { getNextOccurrence } from "./timer.ts";

export function parseCronAddArgs(args: string[]):
  | {
      id: string;
      schedule: string;
      timezone: string;
      prompt: string;
    }
  | undefined {
  if (args.length < 8) {
    return;
  }
  const [id, minute, hour, dayOfMonth, month, dayOfWeek, timezone, ...promptParts] = args;
  const prompt = promptParts.join(" ");
  if (!id || !minute || !hour || !dayOfMonth || !month || !dayOfWeek || !timezone || !prompt) {
    return;
  }
  return {
    id,
    schedule: [minute, hour, dayOfMonth, month, dayOfWeek].join(" "),
    timezone,
    prompt,
  };
}

export function parseCronIdArg(args: string[], usage: string): { id: string } | { error: string } {
  const id = args[0];
  if (!id || args.length !== 1) {
    return { error: usage };
  }
  const cronIdResult = cronIdSchema.safeParse(id);
  if (!cronIdResult.success) {
    return { error: "Invalid cron id. Use letters, numbers, underscores, or hyphens." };
  }
  return { id };
}

export function renderCronList(cronStore: CronStore): string {
  const jobs = cronStore.listJobs();
  if (jobs.length === 0) {
    return "No cron jobs.";
  }
  return jobs.map((job) => renderCronListItem(job, cronStore.getLatestRun(job.id))).join("\n");
}

export function renderCronShow(job: CronJob, latestRun: CronRun | undefined): string {
  return `\
id: ${job.id}
enabled: ${job.enabled ? "yes" : "no"}
schedule: ${job.schedule}
timezone: ${job.timezone}
target session: ${job.target.sessionName}
delivery target: ${formatDeliveryTarget(job.target.delivery)}
next: ${formatCronNext(job)}
last: ${formatCronLastRun(latestRun)}
prompt: ${job.prompt}
`;
}

function renderCronListItem(job: CronJob, latestRun: CronRun | undefined): string {
  return `\
- ${job.id} [${job.enabled ? "enabled" : "disabled"}]
  schedule: ${job.schedule}
  timezone: ${job.timezone}
  target session: ${job.target.sessionName}
  delivery target: ${formatDeliveryTarget(job.target.delivery)}
  next: ${formatCronNext(job)}
  last: ${formatCronLastRun(latestRun)}
`;
}

function formatDeliveryTarget(target: CronJob["target"]["delivery"]): string {
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
