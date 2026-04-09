const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is required");
  process.exit(1);
}

export const BOT_TOKEN: string = token;

export const AGENT = process.env.AGENT ?? "codex";
export const CWD = process.env.DAEMON_CWD ?? process.cwd();

export const ALLOWED_USERS = new Set(
  (process.env.ALLOWED_USER_IDS ?? "").split(",").filter(Boolean).map(Number),
);
export const ALLOWED_CHATS = new Set(
  (process.env.ALLOWED_CHAT_IDS ?? "").split(",").filter(Boolean).map(Number),
);
