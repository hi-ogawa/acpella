import { afterEach, expect, test, vi } from "vitest";
import { normalizeUserMention, TelegramChatActionManager } from "./utils.ts";

afterEach(() => {
  vi.useRealTimers();
});

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
