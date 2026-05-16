import { createWriteStream, mkdirSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Bot } from "grammy";
import type { Document } from "grammy/types";

const TELEGRAM_UPLOAD_DIR = "/tmp/acpella-uploads";

export async function downloadTelegramFile({
  bot,
  document,
}: {
  bot: Bot;
  document: Document;
}): Promise<string> {
  const file = await bot.api.getFile(document.file_id);
  if (!file.file_path) {
    throw new Error(`Telegram file path is missing for file_id=${document.file_id}`);
  }
  const url = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download Telegram file: ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error(`Failed to download Telegram file: response body is missing`);
  }
  mkdirSync(TELEGRAM_UPLOAD_DIR, { recursive: true });
  const fallbackName = document.file_name ?? path.basename(file.file_path);
  const baseName = path.basename(fallbackName) || document.file_id;
  const outputPath = path.join(
    TELEGRAM_UPLOAD_DIR,
    `${Date.now()}-${document.file_id}-${baseName}`,
  );
  await pipeline(Readable.fromWeb(response.body as any), createWriteStream(outputPath));
  return outputPath;
}
