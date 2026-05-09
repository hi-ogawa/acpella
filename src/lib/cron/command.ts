import { formatTime, Result } from "../../utils/index.ts";
import { type CronJob, type CronRun, type CronStore, cronIdSchema } from "./store.ts";
import { getNextCronSchedule, validateCronSchedule } from "./timer.ts";

export function parseCronArgs(args: string[], timezone: string) {
  let [id, minute, hour, dayOfMonth, month, dayOfWeek, ...restArgs] = args;
  if (!id || !minute || !hour || !dayOfMonth || !month || !dayOfWeek) {
    throw new Error("Invalid input");
  }
  const cronIdResult = cronIdSchema.safeParse(id);
  if (!cronIdResult.success) {
    throw new Error("Invalid cron id. Use letters, numbers, underscores, or hyphens.");
  }
  const schedule = [minute, hour, dayOfMonth, month, dayOfWeek].join(" ");
  validateCronSchedule({ schedule, timezone });

  let target: string | undefined;
  let once = false;

  while (restArgs.length > 0 && restArgs[0] !== "--") {
    if (restArgs[0] === "--target") {
      if (!restArgs[1]) {
        throw new Error("Missing value for --target");
      }
      target = restArgs[1];
      restArgs = restArgs.slice(2);
    } else if (restArgs[0] === "--once") {
      once = true;
      restArgs = restArgs.slice(1);
    } else {
      throw new Error(`Unknown option: ${restArgs[0]}`);
    }
  }

  let prompt: string | undefined;
  if (restArgs.length > 0) {
    if (restArgs[0] !== "--") {
      throw new Error("Missing -- separator before prompt");
    }
    prompt = restArgs.slice(1).join(" ");
    if (!prompt) {
      throw new Error("prompt is empty");
    }
  }

  return { id, schedule, target, once, prompt };
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

export function parseCronListArgs(
  args: string[],
  timezone: string,
  usage: string,
): Result<{ agenda?: Temporal.PlainDate }, string> {
  if (args.length === 0) {
    return Result.ok({});
  }
  if (args.length !== 1) {
    return Result.err(usage);
  }
  const arg = args[0];
  if (arg === "--agenda") {
    return Result.ok({
      agenda: Temporal.Now.zonedDateTimeISO(timezone).toPlainDate(),
    });
  }
  if (arg.startsWith("--agenda=")) {
    const value = arg.slice("--agenda=".length);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return Result.err("Invalid date format. Use YYYY-MM-DD.");
    }
    try {
      return Result.ok({ agenda: Temporal.PlainDate.from(value) });
    } catch {
      return Result.err("Invalid date format. Use YYYY-MM-DD.");
    }
  }
  return Result.err(usage);
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

export function renderCronAgenda(options: {
  cronStore: CronStore;
  timezone: string;
  date: Temporal.PlainDate;
}): string {
  const dayStart = Temporal.ZonedDateTime.from({
    timeZone: options.timezone,
    year: options.date.year,
    month: options.date.month,
    day: options.date.day,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  });
  const dayStartMs = dayStart.epochMilliseconds;
  const dayEndMs = dayStart.add({ days: 1 }).epochMilliseconds;

  const entries: Array<{ id: string; sessionName: string; scheduledAt: number }> = [];
  for (const job of options.cronStore.listJobs()) {
    if (!job.enabled) {
      continue;
    }
    try {
      // Start just before day start so schedules exactly at 00:00 are included.
      let after = dayStartMs - 1;
      while (true) {
        const scheduledAt = getNextCronSchedule({
          schedule: job.schedule,
          timezone: job.timezone,
          after,
        });
        if (scheduledAt >= dayEndMs) {
          break;
        }
        entries.push({
          id: job.id,
          sessionName: job.target.sessionName,
          scheduledAt,
        });
        after = scheduledAt;
      }
    } catch (error) {
      console.error(`[cron] Failed to calculate agenda for '${job.id}':`, error);
    }
  }

  entries.sort((a, b) => {
    const timeDiff = a.scheduledAt - b.scheduledAt;
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return a.id.localeCompare(b.id);
  });
  const header = `Cron agenda for ${options.date.toString()} (${options.timezone})`;
  if (entries.length === 0) {
    return `${header}\n(no scheduled jobs)`;
  }
  return `${header}\n\n${entries
    .map((entry) => {
      const zoned = Temporal.Instant.fromEpochMilliseconds(entry.scheduledAt).toZonedDateTimeISO(
        options.timezone,
      );
      const hh = String(zoned.hour).padStart(2, "0");
      const mm = String(zoned.minute).padStart(2, "0");
      return `${hh}:${mm}  ${entry.id}  ${entry.sessionName}`;
    })
    .join("\n")}`;
}

export function renderCronShow(job: CronJob, latestRun: CronRun | undefined): string {
  return `\
id: ${job.id}
enabled: ${job.enabled ? "yes" : "no"}
once: ${job.once ? "yes" : "no"}
schedule: ${job.schedule}
timezone: ${job.timezone}
target session: ${job.target.sessionName}
delivery target: ${formatDeliveryTarget(job.target.delivery)}
next: ${formatCronNext(job)}
last: ${formatCronLastRun(latestRun, job.timezone)}
prompt: ${job.prompt}
`;
}

function renderCronListItem(job: CronJob, latestRun: CronRun | undefined): string {
  const status = [job.enabled ? "enabled" : "disabled", ...(job.once ? ["once"] : [])].join(", ");
  return `\
- ${job.id} [${status}]
  schedule: ${job.schedule}
  timezone: ${job.timezone}
  target session: ${job.target.sessionName}
  delivery target: ${formatDeliveryTarget(job.target.delivery)}
  next: ${formatCronNext(job)}
  last: ${formatCronLastRun(latestRun, job.timezone)}
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

function formatCronLastRun(run: CronRun | undefined, timezone: string): string {
  if (!run) {
    return "none";
  }
  const scheduledAt = formatTime(Date.parse(run.scheduledAt), timezone);
  let output = `${run.status}, scheduled ${scheduledAt}`;
  if (run.finishedAt) {
    output += `, finished ${formatTime(Date.parse(run.finishedAt), timezone)}`;
  }
  if (run.error) {
    output += `, error: ${run.error}`;
  }
  return output;
}
