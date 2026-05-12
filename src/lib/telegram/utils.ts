import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { GrammyError, type Context } from "grammy";

export function normalizeUserMention({
  text,
  username,
}: {
  text: string;
  username: string;
}): string {
  const match = text.match(/^(\/\w+)@(\w+)(?=\s|$)/);
  if (match) {
    const [prefix, command, target] = match;
    if (target.toLowerCase() === username.toLowerCase()) {
      const rest = text.slice(prefix.length);
      return `${command}${rest}`;
    }
  }
  return text;
}

export function formatTelegramSessionName(context: Context): string {
  return ["tg", context.chat?.id ?? "unknown", context.message?.message_thread_id]
    .filter(Boolean)
    .join("-");
}

// TODO: standardize one-to-one mapping between sessionName and CronDeliveryTarget
export function parseTelegramSessionName(sessionName: string) {
  const match = /^tg-(-?\d+)(?:-(\d+))?$/.exec(sessionName);
  if (!match) {
    return;
  }
  const chatId = parseInt(match[1]!, 10);
  const messageThreadId = match[2] ? parseInt(match[2], 10) : undefined;
  return { chatId, messageThreadId };
}

export function formatTelegramConversationMetadata(context: Context): string {
  const chat = context.chat;
  if (!chat) {
    return "telegram:unknown";
  }
  if (chat.type === "private") {
    return "telegram:direct";
  }
  const messageThreadId = context.message?.message_thread_id;
  if (messageThreadId !== undefined) {
    return `telegram:group:${chat.title}:topic:${messageThreadId}`;
  }
  return `telegram:group:${chat.title}`;
}

export function getTelegramRetryAfter(error: unknown): number | undefined {
  if (error instanceof GrammyError && error.error_code === 429) {
    return error.parameters.retry_after;
  }
}

export function getTelegramUploadFileId(
  message: NonNullable<Context["message"]>,
): string | undefined {
  if ("photo" in message && message.photo && message.photo.length > 0) {
    return message.photo.at(-1)?.file_id;
  }
  if ("document" in message && message.document) {
    return message.document.file_id;
  }
  if ("video" in message && message.video) {
    return message.video.file_id;
  }
  if ("voice" in message && message.voice) {
    return message.voice.file_id;
  }
  if ("audio" in message && message.audio) {
    return message.audio.file_id;
  }
}

export function formatTelegramUploadPrompt({
  caption,
  filePath,
}: {
  caption?: string;
  filePath: string;
}): string {
  if (!caption?.trim()) {
    return `[User uploaded file: ${filePath}]`;
  }
  return `${caption}\n\n[User uploaded file: ${filePath}]`;
}

export async function downloadTelegramFile({
  getFile,
  token,
  fileId,
  uploadDir,
  now = Date.now,
  uuid = randomUUID,
  fetchImpl = fetch,
}: {
  getFile: (fileId: string) => Promise<{ file_path?: string }>;
  token: string;
  fileId: string;
  uploadDir: string;
  now?: () => number;
  uuid?: () => string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const file = await getFile(fileId);
  if (!file.file_path) {
    throw new Error(`file_path is missing for file_id=${fileId}`);
  }
  const response = await fetchImpl(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!response.ok) {
    throw new Error(`download failed: ${response.status} ${response.statusText}`);
  }
  const extension = path.extname(path.basename(file.file_path)).replaceAll(/[^a-zA-Z0-9.]/g, "");
  const safeFileId = fileId.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
  const outputPath = path.join(uploadDir, `${now()}-${safeFileId}-${uuid()}${extension}`);
  await mkdir(uploadDir, { recursive: true });
  await writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
  return outputPath;
}

// Telegram chat actions last 5 seconds or less, so match OpenClaw's cadence:
// delayed first cue to avoid flashing on fast replies, then 3s keepalive.
// https://core.telegram.org/bots/api#sendchataction
// See refs/openclaw/src/channels/typing.ts and refs/openclaw/src/channels/typing-lifecycle.ts.
export class TelegramChatActionManager {
  options: {
    send: () => Promise<unknown>;
    logLabel: string;
  };
  timeout?: ReturnType<typeof setTimeout>;
  interval?: ReturnType<typeof setInterval>;
  inFlight = false;
  stopped = true;
  retryAfterUntil = 0;

  constructor(options: TelegramChatActionManager["options"]) {
    this.options = options;
  }

  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.timeout = setTimeout(() => {
      this.timeout = undefined;
      void this.trySend();
      this.interval = setInterval(() => void this.trySend(), 3000);
    }, 1000);
  }

  stop(): void {
    this.stopped = true;
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = undefined;
    }
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  private async trySend(): Promise<void> {
    if (this.stopped || this.inFlight || Date.now() < this.retryAfterUntil) {
      return;
    }
    this.inFlight = true;
    try {
      await this.options.send();
    } catch (error) {
      const retryAfter = getTelegramRetryAfter(error);
      if (!retryAfter) {
        console.error(`${this.options.logLabel} typing indicator failed:`, error);
        this.stop();
        return;
      }
      console.error(
        `${this.options.logLabel} typing indicator rate limited; pausing for ${retryAfter}s:`,
        error,
      );
      this.retryAfterUntil = Date.now() + (retryAfter + 1) * 1000;
    } finally {
      this.inFlight = false;
    }
  }
}
