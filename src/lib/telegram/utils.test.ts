import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, onTestFinished, test, vi } from "vitest";
import {
  downloadTelegramFile,
  formatTelegramUploadPrompt,
  getTelegramUploadFileId,
  normalizeUserMention,
  TelegramChatActionManager,
} from "./utils.ts";

test(normalizeUserMention, () => {
  const username = "good_bot";
  function runTest(text: string) {
    return normalizeUserMention({ text, username });
  }
  expect(runTest("/status")).toMatchInlineSnapshot(`"/status"`);
  expect(runTest("/status@good_bot")).toMatchInlineSnapshot(`"/status"`);
  expect(runTest("/session@good_bot new test")).toMatchInlineSnapshot(`"/session new test"`);
  expect(runTest("/status@good_bot/new")).toMatchInlineSnapshot(`"/status@good_bot/new"`);
  expect(runTest("/status@bad_bot")).toMatchInlineSnapshot(`"/status@bad_bot"`);
  expect(runTest("hello /status@good_bot")).toMatchInlineSnapshot(`"hello /status@good_bot"`);
});

test("TelegramChatActionManager delays the first chat action by 1s", async () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });

  const send = vi.fn(async () => undefined);
  const manager = new TelegramChatActionManager({
    send,
    logLabel: "[test]",
  });

  manager.start();
  expect(send).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(999);
  expect(send).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(1);
  expect(send).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(3000);
  expect(send).toHaveBeenCalledTimes(2);

  manager.stop();
});

test("TelegramChatActionManager clears the delayed chat action on stop", async () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });

  const send = vi.fn(async () => undefined);
  const manager = new TelegramChatActionManager({
    send,
    logLabel: "[test]",
  });

  manager.start();
  manager.stop();

  await vi.advanceTimersByTimeAsync(1000);
  expect(send).not.toHaveBeenCalled();
});

test(getTelegramUploadFileId, () => {
  expect(
    getTelegramUploadFileId({
      photo: [{ file_id: "small" }, { file_id: "large" }],
    } as never),
  ).toBe("large");
  expect(getTelegramUploadFileId({ document: { file_id: "doc" } } as never)).toBe("doc");
  expect(getTelegramUploadFileId({ video: { file_id: "video" } } as never)).toBe("video");
  expect(getTelegramUploadFileId({ voice: { file_id: "voice" } } as never)).toBe("voice");
  expect(getTelegramUploadFileId({ audio: { file_id: "audio" } } as never)).toBe("audio");
  expect(getTelegramUploadFileId({} as never)).toBe(undefined);
});

test(formatTelegramUploadPrompt, () => {
  expect(
    formatTelegramUploadPrompt({
      filePath: "/tmp/acpella-uploads/test.png",
    }),
  ).toMatchInlineSnapshot(`"[User uploaded file: /tmp/acpella-uploads/test.png]"`);
  expect(
    formatTelegramUploadPrompt({
      caption: "please check this",
      filePath: "/tmp/acpella-uploads/test.png",
    }),
  ).toMatchInlineSnapshot(`
    "please check this
    
    [User uploaded file: /tmp/acpella-uploads/test.png]"
  `);
});

test(downloadTelegramFile, async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "acpella-upload-test-"));
  const filePath = await downloadTelegramFile({
    getFile: async () => ({ file_path: "media/..screenshot?.png" }),
    token: "dummy-token",
    fileId: "ab:c",
    uploadDir,
    now: () => 123,
    uuid: () => "uuid",
    fetchImpl: async () => new Response("test-content"),
  });
  expect(filePath).toMatch(`${uploadDir}/123-ab_c-uuid.png`);
  expect(await readFile(filePath, "utf-8")).toBe("test-content");
});

test("downloadTelegramFile throws on missing file_path", async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "acpella-upload-test-"));
  await expect(
    downloadTelegramFile({
      getFile: async () => ({}),
      token: "dummy-token",
      fileId: "ab:c",
      uploadDir,
      fetchImpl: async () => new Response("test-content"),
    }),
  ).rejects.toThrowError("file_path is missing for file_id=ab:c");
});

test("downloadTelegramFile throws on HTTP error", async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), "acpella-upload-test-"));
  await expect(
    downloadTelegramFile({
      getFile: async () => ({ file_path: "media/screenshot.png" }),
      token: "dummy-token",
      fileId: "ab:c",
      uploadDir,
      fetchImpl: async () => new Response("bad", { status: 500, statusText: "Boom" }),
    }),
  ).rejects.toThrowError("download failed: 500 Boom");
});
