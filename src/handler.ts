import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// use local dep binary instead of npx
const ACPX_BIN = fileURLToPath(new URL("../node_modules/.bin/acpx", import.meta.url));

// --- acpx ---

async function ensureSession(_sessionName: string, agent: string, cwd: string): Promise<void> {
  await execFileAsync(
    ACPX_BIN,
    [
      "--cwd",
      cwd,
      "--approve-all",
      agent,
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
  agent: string,
  cwd: string,
): Promise<string> {
  await ensureSession(sessionName, agent, cwd);

  const { stdout } = await execFileAsync(
    ACPX_BIN,
    [
      "--approve-all",
      "--format",
      "json",
      agent,
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

export function createHandler(
  config: HandlerConfig,
): (text: string, session: string) => Promise<string> {
  return async (text, session) => {
    if (text === "/status") {
      return formatStatus(config.agent, config.cwd);
    }
    return acpxPrompt(session, text, config.agent, config.cwd);
  };
}
