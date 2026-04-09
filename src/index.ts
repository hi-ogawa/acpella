import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Bot } from "grammy";

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

// --- telegram ---

function sessionName(chatId: number, threadId?: number): string {
  const base = `tg-${chatId}`;
  return threadId ? `${base}-${threadId}` : base;
}

function formatStatus(agent: string, cwd: string): string {
  return ["daemon state: running", `configured agent: ${agent}`, `working directory: ${cwd}`].join(
    "\n",
  );
}

// --- main ---

function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is required");
    process.exit(1);
  }

  const agent = process.env.AGENT ?? "codex";
  const cwd = process.env.DAEMON_CWD ?? process.cwd();
  const allowedUsers = new Set(
    (process.env.ALLOWED_USER_IDS ?? "").split(",").filter(Boolean).map(Number),
  );
  const allowedChats = new Set(
    (process.env.ALLOWED_CHAT_IDS ?? "").split(",").filter(Boolean).map(Number),
  );

  const bot = new Bot(token);

  bot.on("message:text", async (ctx) => {
    const userId = ctx.from?.id;
    const chatId = ctx.chat.id;
    const threadId = ctx.message.message_thread_id;

    if (allowedChats.size > 0 && !allowedChats.has(chatId)) return;
    if (!userId || (allowedUsers.size > 0 && !allowedUsers.has(userId))) return;

    const name = sessionName(chatId, threadId);
    const text = ctx.message.text;

    console.log(`[${name}] <- ${text}`);

    try {
      if (text === "/status") {
        await ctx.reply(formatStatus(agent, cwd));
        return;
      }

      const response = await acpxPrompt(name, text, agent, cwd);
      console.log(`[${name}] -> ${response.slice(0, 100)}...`);
      await ctx.reply(response);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${name}] error: ${msg}`);
      await ctx.reply(`Error: ${msg.slice(0, 200)}`);
    }
  });

  console.log(`Starting daemon (agent: ${agent}, cwd: ${cwd})`);
  bot.start();
}

main();
