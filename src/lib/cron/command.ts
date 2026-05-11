import { formatTime, sortBy } from "../../utils/index.ts";
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

export function parseCronIdArg(args: string[]): string {
  const id = args[0];
  if (!id || args.length !== 1) {
    throw new Error("Invalid input");
  }
  const cronIdResult = cronIdSchema.safeParse(id);
  if (!cronIdResult.success) {
    throw new Error("Invalid cron id. Use letters, numbers, underscores, or hyphens.");
  }
  return id;
}

export function parseCronListArgs(args: string[]) {
  if (args.length === 0) {
    return { compact: false };
  }
  if (args.length === 1 && args[0] === "--compact") {
    return { compact: true };
  }
  throw new Error("Invalid arguments");
}

export function renderCronList(cronStore: CronStore, options: { compact: boolean }): string {
  const jobs = cronStore.listJobs();
  if (jobs.length === 0) {
    return "No cron jobs.";
  }
  if (options.compact) {
    return renderCronListCompact(cronStore, jobs);
  }
  return jobs
    .map((job) => renderCronListItem(job, cronStore.getLatestRun({ cronId: job.id })))
    .join("\n");
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

function renderCronListCompact(cronStore: CronStore, jobs: CronJob[]): string {
  const sortedJobs = sortBy(jobs, (job) => job.id);
  const enabledJobs = sortedJobs.filter((job) => job.enabled);
  const disabledJobs = sortedJobs.filter((job) => !job.enabled);
  // TODO: move up to top-level command handler callsite
  const timestamp = Date.now();
  const enabledEntries = enabledJobs.map((job) => ({
    job,
    latestRun: cronStore.getLatestRun({ cronId: job.id }),
    nextAt: getNextCronSchedule({
      schedule: job.schedule,
      timezone: job.timezone,
      after: timestamp,
    }),
  }));
  const lines = sortBy(enabledEntries, (entry) => entry.nextAt).map(
    ({ job, latestRun, nextAt }) => {
      const datetime = formatCronCompactDateTime(nextAt, job.timezone);
      const markers = formatCronCompactMarkers(job, latestRun);
      return `${datetime} | ${job.id}${markers}`;
    },
  );
  if (disabledJobs.length === 0) {
    return lines.join("\n");
  }
  const disabledSection = `\
disabled:
${disabledJobs
  .map((job) => {
    const latestRun = cronStore.getLatestRun({ cronId: job.id });
    const markers = formatCronCompactMarkers(job, latestRun);
    return `- ${job.id}${markers}`;
  })
  .join("\n")}`;
  if (lines.length === 0) {
    return disabledSection;
  }
  return `${lines.join("\n")}\n\n${disabledSection}`;
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
  const nextAt = getNextCronSchedule({
    schedule: job.schedule,
    timezone: job.timezone,
    after: Date.now(),
  });
  return formatTime(nextAt, job.timezone);
}

function formatCronCompactDateTime(time: number, timezone: string): string {
  const zoned = Temporal.Instant.fromEpochMilliseconds(time).toZonedDateTimeISO(timezone);
  const month = MONTH_NAMES[zoned.month - 1]!;
  const day = String(zoned.day).padStart(2, " ");
  const hour = String(zoned.hour).padStart(2, "0");
  const minute = String(zoned.minute).padStart(2, "0");
  return `${month} ${day} | ${hour}:${minute}`;
}

function formatCronCompactMarkers(job: CronJob, latestRun: CronRun | undefined): string {
  const markers: string[] = [];
  if (latestRun?.status === "failed") {
    markers.push("failed");
  }
  if (job.once) {
    markers.push("once");
  }
  return markers.map((marker) => ` (${marker})`).join("");
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

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
