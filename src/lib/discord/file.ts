import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { ACPELLA_UPLOAD_DIR } from "../uploads.ts";

// send via plain REST so short-lived processes (e.g. `acpella exec`) can deliver
// without a gateway connection
export async function sendDiscordMessageViaRest({
  token,
  channelId,
  text,
  files,
}: {
  token: string;
  channelId: string;
  text?: string;
  files?: string[];
}): Promise<void> {
  const form = new FormData();
  form.append("payload_json", JSON.stringify({ content: text ?? "" }));
  for (const [index, filePath] of (files ?? []).entries()) {
    const data = await fs.promises.readFile(filePath);
    form.append(`files[${index}]`, new Blob([data]), path.basename(filePath));
  }
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}` },
    body: form,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Failed to send Discord message: ${response.status} ${response.statusText} ${body}`,
    );
  }
}

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
  const baseName = path.basename(fileName) || "attachment";
  const outputPath = path.join(ACPELLA_UPLOAD_DIR, "discord", `${Date.now()}-${baseName}`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await fs.promises.writeFile(outputPath, Readable.fromWeb(response.body as any));
  return outputPath;
}
