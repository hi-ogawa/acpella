import { formatError, formatTime, resultErr, resultOk, type Result } from "../lib/utils.ts";
import {
  type CronDeliveryTarget,
  type CronJob,
  type CronRun,
  type CronStore,
  cronIdSchema,
} from "./store.ts";
import { getNextCronSchedule, validateCronSchedule } from "./timer.ts";

export function parseTelegramSessionTarget(sessionName: string): {
  sessionName: string;
  deliveryTarget: CronDeliveryTarget;
} | null {
  // Format: tg-<chatId> or tg-<chatId>-<messageThreadId>
  const match = /^tg-(-?\d+)(?:-(\d+))?$/.exec(sessionName);
  if (!match) {
    return null;
  }
  const chatId = parseInt(match[1]!, 10);
  const messageThreadId = match[2] !== undefined ? parseInt(match[2], 10) : undefined;
  const deliveryTarget: CronDeliveryTarget = {
    telegram: {
      chatId,
      ...(messageThreadId !== undefined ? { messageThreadId } : {}),
    },
  };
  return { sessionName, deliveryTarget };
}

export function parseCronAddArgs(
  args: string[],
  timezone: string,
): Result<
  {
    id: string;
    schedule: string;
    prompt: string;
    sessionName?: string;
    deliveryTarget?: CronDeliveryTarget;
  },
  string
> {
  if (args.length < 7) {
    return { ok: false, value: "Invalid input" };
  }
  const [id, minute, hour, dayOfMonth, month, dayOfWeek, ...rest] = args;
  if (!id || !minute || !hour || !dayOfMonth || !month || !dayOfWeek) {
    return resultErr("Invalid input");
  }

  // Parse named options and -- separator from rest
  let sessionName: string | undefined;
  let deliveryTarget: CronDeliveryTarget | undefined;
  const promptParts: string[] = [];

  const separatorIndex = rest.indexOf("--");
  if (separatorIndex !== -1) {
    // Options are everything before --; prompt is everything after --
    const optionParts = rest.slice(0, separatorIndex);
    const afterSeparator = rest.slice(separatorIndex + 1);
    for (let i = 0; i < optionParts.length; i++) {
      if (optionParts[i] === "--session") {
        const val = optionParts[i + 1];
        if (!val) {
          return resultErr("Missing value for --session");
        }
        i++;
        const telegramTarget = parseTelegramSessionTarget(val);
        if (telegramTarget) {
          sessionName = telegramTarget.sessionName;
          deliveryTarget = telegramTarget.deliveryTarget;
        } else {
          sessionName = val;
        }
      } else {
        return resultErr(`Unknown option: ${optionParts[i]}`);
      }
    }
    promptParts.push(...afterSeparator);
  } else {
    promptParts.push(...rest);
  }

  const prompt = promptParts.join(" ");
  if (!prompt) {
    return resultErr("Invalid input");
  }
  const cronIdResult = cronIdSchema.safeParse(id);
  if (!cronIdResult.success) {
    return resultErr("Invalid cron id. Use letters, numbers, underscores, or hyphens.");
  }
  const schedule = [minute, hour, dayOfMonth, month, dayOfWeek].join(" ");
  try {
    validateCronSchedule({ schedule, timezone });
  } catch (error) {
    return resultErr(`Invalid cron schedule: ${formatError(error)}`);
  }
  return resultOk({ id, schedule, prompt, sessionName, deliveryTarget });
}

export function parseCronIdArg(args: string[], usage: string): Result<{ id: string }, string> {
  const id = args[0];
  if (!id || args.length !== 1) {
    return resultErr(usage);
  }
  const cronIdResult = cronIdSchema.safeParse(id);
  if (!cronIdResult.success) {
    return resultErr("Invalid cron id. Use letters, numbers, underscores, or hyphens.");
  }
  return resultOk({ id });
}

export function renderCronList(cronStore: CronStore): string {
  const jobs = cronStore.listJobs();
  if (jobs.length === 0) {
    return "No cron jobs.";
  }
  return jobs
    .map((job) => renderCronListItem(job, cronStore.getLatestRun({ cronId: job.id })))
    .join("\n");
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
  const surfaces: string[] = [];
  if (target.telegram) {
    let output = `telegram:${target.telegram.chatId}`;
    if (target.telegram.messageThreadId !== undefined) {
      output += `/${target.telegram.messageThreadId}`;
    }
    surfaces.push(output);
  }
  if (target.repl) {
    surfaces.push("repl");
  }
  return surfaces.join(", ");
}

function formatCronNext(job: CronJob): string {
  if (!job.enabled) {
    return "none";
  }
  try {
    return formatTime(
      getNextCronSchedule({
        schedule: job.schedule,
        timezone: job.timezone,
        after: Date.now(),
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
