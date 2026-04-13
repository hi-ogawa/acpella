import { Cron } from "croner";
import type { Api } from "grammy";
import type { startAcpManager } from "../acp/index.ts";
import type { AppConfig } from "../config.ts";
import {
  getNextRunTimes,
  loadCronEntries,
  loadCronState,
  runKey,
  saveCronState,
  type CronEntry,
  type CronState,
} from "./cron.ts";

const MESSAGE_SPLIT_BUDGET = 3900;
/** Polling interval for cron.json file reload (ms). */
const RELOAD_INTERVAL_MS = 60_000;

type AcpManager = Awaited<ReturnType<typeof startAcpManager>>;

interface CronSchedulerOptions {
  config: Pick<AppConfig, "cronFile" | "cronStateFile" | "home">;
  manager: AcpManager;
  telegramApi?: Api;
}

export interface CronScheduler {
  start(): void;
  stop(): void;
  listCrons(): Array<{ entry: CronEntry; nextRunAt: Date | undefined }>;
  runNow(cronId: string): Promise<string>;
  showNextRuns(cronId: string, count?: number): string;
}

export function createCronScheduler(options: CronSchedulerOptions): CronScheduler {
  const { config, manager, telegramApi } = options;

  /** Active croner jobs keyed by cron entry id. */
  const activeJobs = new Map<string, Cron>();
  /** In-memory set of cron IDs that are currently running — prevents overlapping runs. */
  const activeRuns = new Set<string>();
  /** Timer used to periodically reload cron.json and sync active jobs. */
  let reloadTimer: ReturnType<typeof setInterval> | undefined;

  // ---------------------------------------------------------------------------
  // State helpers
  // ---------------------------------------------------------------------------

  function readEntries(): CronEntry[] {
    return loadCronEntries(config.cronFile);
  }

  function readState(): CronState {
    return loadCronState(config.cronStateFile);
  }

  function writeState(state: CronState): void {
    saveCronState(config.cronStateFile, state);
  }

  // ---------------------------------------------------------------------------
  // Job firing
  // ---------------------------------------------------------------------------

  async function fireEntry(entry: CronEntry, scheduledFor: Date): Promise<void> {
    const firedAt = new Date();
    const key = runKey(entry.id, scheduledFor);

    const state = readState();

    // Duplicate check (persistent state)
    if (state.runs[key]) {
      console.log(`[cron] skipping duplicate run: ${key}`);
      return;
    }

    // Overlapping-run check (in-memory, within this process)
    if (activeRuns.has(entry.id)) {
      console.log(`[cron] skipping overlapping run: ${entry.id}`);
      return;
    }
    activeRuns.add(entry.id);

    console.log(`[cron] firing: ${entry.id} (scheduled: ${scheduledFor.toISOString()})`);

    // Mark as in-progress (optimistic write to prevent concurrent runs across restarts)
    state.runs[key] = { firedAt: firedAt.toISOString(), success: false };
    state.jobs[entry.id] = {
      ...state.jobs[entry.id],
      lastRunAt: firedAt.toISOString(),
    };
    writeState(state);

    let success = false;
    let lastError: string | undefined;

    try {
      const promptText = formatCronPrompt({ entry, scheduledFor, firedAt });
      const responseText = await runAgentTurn({ entry, promptText });

      if (telegramApi) {
        await deliverToTelegram({ entry, text: responseText, telegramApi });
      } else {
        console.log(`[cron] response (no telegram): ${responseText.slice(0, 200)}`);
      }
      success = true;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.error(`[cron] error firing ${entry.id}:`, e);
    } finally {
      activeRuns.delete(entry.id);
    }

    // Update state
    const finalState = readState();
    finalState.runs[key] = {
      firedAt: firedAt.toISOString(),
      success,
      ...(lastError !== undefined ? { error: lastError } : {}),
    };
    finalState.jobs[entry.id] = {
      ...finalState.jobs[entry.id],
      lastRunAt: firedAt.toISOString(),
      lastSuccess: success,
      ...(lastError !== undefined ? { lastError } : {}),
    };
    writeState(finalState);
  }

  async function runAgentTurn(options: { entry: CronEntry; promptText: string }): Promise<string> {
    const { entry, promptText } = options;
    const sessionId = entry.target.session_id;
    const session = await manager.loadSession({
      sessionCwd: config.home,
      sessionId,
    });
    try {
      const { queue } = session.prompt(promptText);
      let responseText = "";
      for await (const update of queue) {
        if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
          responseText += update.content.text;
        }
      }
      return responseText || "(no response)";
    } finally {
      session.close();
    }
  }

  async function deliverToTelegram(options: {
    entry: CronEntry;
    text: string;
    telegramApi: Api;
  }): Promise<void> {
    const { entry, text, telegramApi: api } = options;
    const chatId = entry.target.chat_id;
    const parts = splitText(text, MESSAGE_SPLIT_BUDGET);
    for (const part of parts) {
      // No reply_to_message_id — cron messages appear as normal bot messages
      await api.sendMessage(chatId, part);
    }
  }

  // ---------------------------------------------------------------------------
  // Job synchronization (sync active croner jobs with cron.json)
  // ---------------------------------------------------------------------------

  function syncJobs(): void {
    const entries = readEntries();
    const entryIds = new Set(entries.map((e) => e.id));

    // Stop removed or disabled jobs
    for (const [id, job] of activeJobs) {
      const entry = entries.find((e) => e.id === id);
      if (!entry || !entry.enabled) {
        job.stop();
        activeJobs.delete(id);
        console.log(`[cron] stopped job: ${id}`);
      }
    }

    // Start new or re-enabled jobs
    for (const entry of entries) {
      if (!entry.enabled) {
        continue;
      }
      if (activeJobs.has(entry.id)) {
        continue;
      }

      try {
        const job = new Cron(entry.schedule, { timezone: entry.timezone }, () => {
          const scheduledFor = job.currentRun() ?? new Date();
          fireEntry(entry, scheduledFor).catch((e) => {
            console.error(`[cron] unhandled error in fireEntry ${entry.id}:`, e);
          });
        });
        activeJobs.set(entry.id, job);
        console.log(`[cron] scheduled job: ${entry.id} (${entry.schedule} ${entry.timezone})`);
      } catch (e) {
        console.error(`[cron] failed to schedule job ${entry.id}:`, e);
      }
    }

    // Log removed entries
    for (const id of activeJobs.keys()) {
      if (!entryIds.has(id)) {
        const job = activeJobs.get(id)!;
        job.stop();
        activeJobs.delete(id);
        console.log(`[cron] removed job: ${id}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  return {
    start() {
      if (reloadTimer) {
        return;
      }
      syncJobs();
      reloadTimer = setInterval(() => {
        syncJobs();
      }, RELOAD_INTERVAL_MS);
    },

    stop() {
      if (reloadTimer) {
        clearInterval(reloadTimer);
        reloadTimer = undefined;
      }
      for (const [id, job] of activeJobs) {
        job.stop();
        activeJobs.delete(id);
      }
    },

    listCrons() {
      return readEntries().map((entry) => {
        const job = activeJobs.get(entry.id);
        const nextRunAt = entry.enabled ? (job?.nextRun() ?? undefined) : undefined;
        return { entry, nextRunAt };
      });
    },

    async runNow(cronId: string): Promise<string> {
      const entries = readEntries();
      const entry = entries.find((e) => e.id === cronId);
      if (!entry) {
        return `Cron job not found: ${cronId}`;
      }
      const scheduledFor = new Date();
      try {
        await fireEntry(entry, scheduledFor);
        return `Fired cron job: ${entry.name} (${cronId})`;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return `Error firing ${cronId}: ${msg}`;
      }
    },

    showNextRuns(cronId: string, count = 5): string {
      const entries = readEntries();
      const entry = entries.find((e) => e.id === cronId);
      if (!entry) {
        return `Cron job not found: ${cronId}`;
      }
      const times = getNextRunTimes(entry, count);
      if (times.length === 0) {
        return `No upcoming runs for: ${cronId}`;
      }
      const lines = times.map((t, i) => `${i + 1}. ${t.toISOString()}`);
      return `Next ${times.length} run(s) for ${entry.name} (${cronId}):\n${lines.join("\n")}`;
    },
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatCronPrompt(options: {
  entry: CronEntry;
  scheduledFor: Date;
  firedAt: Date;
}): string {
  const { entry, scheduledFor, firedAt } = options;
  const metadata = `\
<trigger_metadata>
trigger: cron
cron_id: ${entry.id}
scheduled_for: ${scheduledFor.toISOString()}
fired_at: ${firedAt.toISOString()}
timezone: ${entry.timezone}
surface: ${entry.target.surface}
chat_type: dm
</trigger_metadata>`;

  return `${metadata}\n\n${entry.prompt}`;
}

function splitText(text: string, limit: number): string[] {
  const parts: string[] = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    const idx = findSplitIndex(remaining, limit);
    const part = remaining.slice(0, idx).trim();
    if (part) {
      parts.push(part);
    }
    remaining = remaining.slice(idx).trim();
  }
  if (remaining) {
    parts.push(remaining);
  }
  return parts;
}

function findSplitIndex(text: string, budget: number): number {
  const paragraphIndex = text.lastIndexOf("\n\n", budget);
  if (paragraphIndex > budget / 2) {
    return paragraphIndex + 2;
  }
  const lineIndex = text.lastIndexOf("\n", budget);
  if (lineIndex > budget / 2) {
    return lineIndex + 1;
  }
  const spaceIndex = text.lastIndexOf(" ", budget);
  if (spaceIndex > budget / 2) {
    return spaceIndex + 1;
  }
  return budget;
}
