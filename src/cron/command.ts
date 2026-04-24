import { formatError, formatTime, Result } from "../lib/utils.ts";
import { type CronJob, type CronRun, type CronStore, cronIdSchema } from "./store.ts";
import { getNextCronSchedule, validateCronSchedule } from "./timer.ts";

export const CRON_ADD_USAGE =
  "/cron add <id> <minute> <hour> <day-of-month> <month> <day-of-week> [--session <sessionName>] -- <prompt...>";
export const CRON_UPDATE_USAGE =
  "/cron update <id> [<minute> <hour> <day-of-month> <month> <day-of-week>] [--session <sessionName>] [-- <prompt...>]";

export function parseCronAddArgs(
  args: string[],
  timezone: string,
): Result<
  {
    id: string;
    schedule: string;
    prompt: string;
    sessionName?: string;
  },
  string
> {
  if (args.length < 7) {
    return Result.err("Invalid input");
  }
  const [id, minute, hour, dayOfMonth, month, dayOfWeek, ...rest] = args;
  if (!id || !minute || !hour || !dayOfMonth || !month || !dayOfWeek) {
    return Result.err("Invalid input");
  }

  let sessionName: string | undefined;
  if (rest[0] === "--session") {
    if (!rest[1]) {
      return Result.err("Missing value for --session");
    }
    sessionName = rest[1];
    rest.splice(0, 2);
  }

  if (rest[0] !== "--") {
    return Result.err("Missing -- separator before prompt");
  }
  rest.splice(0, 1);

  const prompt = rest.join(" ");
  if (!prompt) {
    return Result.err("Invalid input");
  }
  const cronIdResult = cronIdSchema.safeParse(id);
  if (!cronIdResult.success) {
    return Result.err("Invalid cron id. Use letters, numbers, underscores, or hyphens.");
  }
  const schedule = [minute, hour, dayOfMonth, month, dayOfWeek].join(" ");
  try {
    validateCronSchedule({ schedule, timezone });
  } catch (error) {
    return Result.err(`Invalid cron schedule: ${formatError(error)}`);
  }
  return Result.ok({ id, schedule, prompt, sessionName });
}

export function parseCronUpdateArgs(
  args: string[],
  timezone: string,
): Result<
  {
    id: string;
    schedule?: string;
    prompt?: string;
    sessionName?: string;
  },
  string
> {
  const [id, ...rest] = args;
  if (!id) {
    return Result.err("Invalid input");
  }
  const cronIdResult = cronIdSchema.safeParse(id);
  if (!cronIdResult.success) {
    return Result.err("Invalid cron id. Use letters, numbers, underscores, or hyphens.");
  }

  let schedule: string | undefined;
  if (rest[0] && rest[0] !== "--session" && rest[0] !== "--") {
    if (rest.length < 5) {
      return Result.err("Schedule update requires all five cron fields");
    }
    const [minute, hour, dayOfMonth, month, dayOfWeek] = rest.splice(0, 5);
    if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) {
      return Result.err("Invalid input");
    }
    schedule = [minute, hour, dayOfMonth, month, dayOfWeek].join(" ");
    try {
      validateCronSchedule({ schedule, timezone });
    } catch (error) {
      return Result.err(`Invalid cron schedule: ${formatError(error)}`);
    }
  }

  let sessionName: string | undefined;
  if (rest[0] === "--session") {
    if (!rest[1]) {
      return Result.err("Missing value for --session");
    }
    sessionName = rest[1];
    rest.splice(0, 2);
  }

  let prompt: string | undefined;
  if (rest[0] === "--") {
    rest.splice(0, 1);
    prompt = rest.join(" ");
    if (!prompt) {
      return Result.err("Invalid input");
    }
    rest.splice(0);
  }
  if (rest.length > 0) {
    return Result.err("Unexpected input");
  }
  if (!schedule && !sessionName && !prompt) {
    return Result.err("No updates specified");
  }
  return Result.ok({ id, schedule, prompt, sessionName });
}

export function parseCronIdArg(args: string[], usage: string): Result<{ id: string }, string> {
  const id = args[0];
  if (!id || args.length !== 1) {
    return Result.err(usage);
  }
  const cronIdResult = cronIdSchema.safeParse(id);
  if (!cronIdResult.success) {
    return Result.err("Invalid cron id. Use letters, numbers, underscores, or hyphens.");
  }
  return Result.ok({ id });
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
