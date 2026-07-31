import fs from "node:fs";
import { expect, onTestFinished, test, vi } from "vitest";
import { downloadDiscordAttachment } from "./file.ts";

test("aborts Discord attachment file writing after one minute", async () => {
  const controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
  const fetchMock = vi.fn(async () => {
    return new Response(new ReadableStream());
  });
  vi.stubGlobal("fetch", fetchMock);
  const writeFile = vi
    .spyOn(fs.promises, "writeFile")
    .mockImplementation(async (_file, _data, options) => {
      const signal = options && typeof options === "object" ? options.signal : undefined;
      await new Promise((_, reject) => {
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });
  onTestFinished(() => {
    vi.restoreAllMocks();
  });

  const download = downloadDiscordAttachment({
    url: "https://cdn.discordapp.com/attachment.txt",
    fileName: "attachment.txt",
  });
  await vi.waitFor(() => expect(writeFile).toHaveBeenCalled());

  expect(timeout).toHaveBeenCalledWith(60_000);
  expect(fetchMock).toHaveBeenCalledWith(
    "https://cdn.discordapp.com/attachment.txt",
    expect.objectContaining({ signal: controller.signal }),
  );
  expect(writeFile).toHaveBeenCalledWith(
    expect.any(String),
    expect.anything(),
    expect.objectContaining({ signal: controller.signal }),
  );

  controller.abort();
  await expect(download).rejects.toThrow("Discord attachment download timed out after 60 seconds");
});
