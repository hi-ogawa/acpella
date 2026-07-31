import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { ACPELLA_UPLOAD_DIR } from "../uploads.ts";

export async function downloadDiscordAttachment({
  url,
  fileName,
}: {
  url: string;
  fileName: string;
}): Promise<string> {
  const signal = AbortSignal.timeout(60_000);
  try {
    const response = await fetch(url, { signal });
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
    await fs.promises.writeFile(outputPath, Readable.fromWeb(response.body as any), { signal });
    return outputPath;
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`Discord attachment download timed out after 60 seconds`, { cause: error });
    }
    throw error;
  }
}
