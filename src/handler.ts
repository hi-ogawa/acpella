import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// use local dep binary instead of npx
const ACPX_BIN = fileURLToPath(new URL("../node_modules/.bin/acpx", import.meta.url));

// --- acpx ---

function acpxAgentArgs(agent: string): string[] {
  return agent.includes("/") ? ["--agent", agent] : [agent];
}

async function ensureSession(
  _sessionName: string,
  agentArgs: string[],
  cwd: string,
): Promise<void> {
  await execFileAsync(
    ACPX_BIN,
    [
      "--cwd",
      cwd,
      "--approve-all",
      ...agentArgs,
      "sessions",
      "ensure",
      // TODO: named session not working?
      // "--name", sessionName,
    ],
    {
      timeout: 60_000,
      env: { ...process.env },
    },
  );
}

async function acpxPrompt(
  sessionName: string,
  text: string,
  agentArgs: string[],
  cwd: string,
): Promise<string> {
  await ensureSession(sessionName, agentArgs, cwd);

  const { stdout } = await execFileAsync(
    ACPX_BIN,
    [
      "--approve-all",
      "--format",
      "json",
      ...agentArgs,
      // TODO: named session not working?
      // "-s", sessionName,
      "prompt",
      text,
    ],
    {
      timeout: 300_000, // 5 min
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env },
    },
  );

  // parse JSONRPC envelope output — extract agent text chunks
  const lines = stdout.trim().split("\n");
  const texts: string[] = [];
  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      const update = msg.params?.update;
      if (update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
        texts.push(update.content.text);
      }
    } catch {
      // skip non-json lines
    }
  }
  return texts.join("") || "(no response)";
}

// --- handler ---

export interface HandlerConfig {
  agent: string;
  cwd: string;
}

export function formatStatus(agent: string, cwd: string): string {
  return ["daemon state: running", `configured agent: ${agent}`, `working directory: ${cwd}`].join(
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
    return acpxPrompt(session, text, agentArgs, resolved.cwd);
  };

  return { handle, config: resolved };
}
