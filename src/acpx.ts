import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { AGENT, CWD } from "./config.ts";

const execFileAsync = promisify(execFile);

// use local dep binary instead of npx
const ACPX_BIN = fileURLToPath(new URL("../node_modules/.bin/acpx", import.meta.url));

export async function ensureSession(_sessionName: string): Promise<void> {
  await execFileAsync(
    ACPX_BIN,
    [
      "--cwd",
      CWD,
      "--approve-all",
      AGENT,
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

export async function prompt(sessionName: string, text: string): Promise<string> {
  await ensureSession(sessionName);

  const { stdout } = await execFileAsync(
    ACPX_BIN,
    [
      "--approve-all",
      "--format",
      "json",
      AGENT,
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
