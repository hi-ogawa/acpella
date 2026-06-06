import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

const DISCORD_UPLOAD_DIR = "/tmp/acpella-uploads/discord";

export async function downloadDiscordAttachment({
  url,
  fileName,
}: {
  url: string;
  fileName: string;
}): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download Discord attachment: ${response.status} ${response.statusText}`,
    );
  }
  if (!response.body) {
    throw new Error(`Failed to download Discord attachment: response body is missing`);
  }
  fs.mkdirSync(DISCORD_UPLOAD_DIR, { recursive: true });
  const baseName = path.basename(fileName) || "attachment";
  const outputPath = path.join(DISCORD_UPLOAD_DIR, `${Date.now()}-${baseName}`);
  await fs.promises.writeFile(outputPath, Readable.fromWeb(response.body as any));
  return outputPath;
}
