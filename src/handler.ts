import { fileURLToPath } from "node:url";
import type { SessionNotification, SessionUpdate } from "@agentclientprotocol/sdk";
import { spawnAsync, type SpawnResult } from "./spawn.ts";

// use local dep binary instead of npx
export const ACPX_BIN = fileURLToPath(new URL("../node_modules/.bin/acpx", import.meta.url));

const DEBUG = !!process.env.ACPELLA_DEBUG;

function runAcpx(args: string[], options: { timeout: number; cwd?: string }): Promise<SpawnResult> {
  const finalArgs = DEBUG ? ["--verbose", ...args] : args;
  return spawnAsync(ACPX_BIN, finalArgs, {
    timeout: options.timeout,
    cwd: options.cwd,
    debug: DEBUG,
    label: "acpx",
  });
}

// --- acpx output parsing ---

/** JSONRPC envelope emitted by `acpx --format json` */
interface AcpxJsonLine {
  jsonrpc: "2.0";
  method: string;
  params?: SessionNotification;
}

/** Extract agent text from acpx JSONRPC ndjson output */
function parseAgentText(stdout: string): string {
  const texts: string[] = [];
  for (const line of stdout.trim().split("\n")) {
    try {
      const msg: AcpxJsonLine = JSON.parse(line);
      const update: SessionUpdate | undefined = msg.params?.update;
      if (!update) {
        continue;
      }
      if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
        texts.push(update.content.text);
      } else if (update.sessionUpdate === "tool_call") {
        console.log(`[acpx:update] tool_call: ${update.title}`);
      } else {
        console.log(`[acpx:update] ${update.sessionUpdate}`);
      }
    } catch {
      // skip non-json lines
    }
  }
  return texts.join("") || "(no response)";
}

// --- acpx ---

function acpxAgentArgs(agent: string): string[] {
  return agent.includes("/") ? ["--agent", agent] : [agent];
}

async function ensureSession(sessionName: string, agentArgs: string[], cwd: string): Promise<void> {
  await runAcpx(
    ["--cwd", cwd, "--approve-all", ...agentArgs, "sessions", "ensure", "--name", sessionName],
    { timeout: 60_000 },
  );
}

async function closeSession(sessionName: string, agentArgs: string[], cwd: string): Promise<void> {
  await runAcpx(["--cwd", cwd, ...agentArgs, "sessions", "close", sessionName], {
    timeout: 60_000,
  });
}

async function acpxPrompt(
  sessionName: string,
  text: string,
  agentArgs: string[],
  cwd: string,
): Promise<string> {
  await ensureSession(sessionName, agentArgs, cwd);

  const { stdout } = await runAcpx(
    ["--approve-all", "--format", "json", ...agentArgs, "prompt", "-s", sessionName, text],
    { timeout: 60_000 },
  );

  return parseAgentText(stdout);
}

// --- handler ---

export interface HandlerConfig {
  agent: string;
  cwd: string;
}

export function formatStatus(agent: string, cwd: string): string {
  return ["service state: running", `configured agent: ${agent}`, `working directory: ${cwd}`].join(
    "\n",
  );
}

export function createHandler(config?: Partial<HandlerConfig>): {
  handle: (text: string, session: string) => Promise<string>;
  config: HandlerConfig;
} {
  const resolved: HandlerConfig = {
    agent: config?.agent ?? process.env.ACPELLA_AGENT ?? "codex",
    cwd: config?.cwd ?? process.env.ACPELLA_HOME ?? process.cwd(),
  };
  const agentArgs = acpxAgentArgs(resolved.agent);

  const handle = async (text: string, session: string) => {
    if (text === "/status") {
      return formatStatus(resolved.agent, resolved.cwd);
    }
    if (text === "/reset") {
      await closeSession(session, agentArgs, resolved.cwd);
      return "Session reset. Next message will start a fresh session.";
    }
    return acpxPrompt(session, text, agentArgs, resolved.cwd);
  };

  return { handle, config: resolved };
}
