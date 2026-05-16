import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { Bot } from "grammy";
import type { Document, PhotoSize } from "grammy/types";

const TELEGRAM_UPLOAD_DIR = "/tmp/acpella-uploads";

export async function downloadTelegramDocument({
  bot,
  document,
}: {
  bot: Bot;
  document: Document;
}): Promise<string> {
  return downloadTelegramFile({
    bot,
    fileId: document.file_id,
    fileName: document.file_name,
  });
}

export async function downloadTelegramPhotoSize({
  bot,
  photoSize,
}: {
  bot: Bot;
  photoSize: PhotoSize;
}): Promise<string> {
  return downloadTelegramFile({
    bot,
    fileId: photoSize.file_id,
    fileName: `${photoSize.file_unique_id}.jpg`,
  });
}

async function downloadTelegramFile({
  bot,
  fileId,
  fileName,
}: {
  bot: Bot;
  fileId: string;
  fileName?: string;
}): Promise<string> {
  // https://core.telegram.org/bots/api#getfile
  const telegramFile = await bot.api.getFile(fileId);
  if (!telegramFile.file_path) {
    throw new Error(`Telegram file path is missing for file_id=${fileId}`);
  }
  const url = `https://api.telegram.org/file/bot${bot.token}/${telegramFile.file_path}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download Telegram file: ${response.status} ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error(`Failed to download Telegram file: response body is missing`);
  }
  fs.mkdirSync(TELEGRAM_UPLOAD_DIR, { recursive: true });
  const baseName = path.basename(fileName || telegramFile.file_path) || fileId;
  const outputPath = path.join(TELEGRAM_UPLOAD_DIR, `${Date.now()}-${fileId}-${baseName}`);
  await fs.promises.writeFile(outputPath, Readable.fromWeb(response.body as any));
  return outputPath;
}
