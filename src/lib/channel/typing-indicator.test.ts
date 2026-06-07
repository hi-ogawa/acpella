import { expect, onTestFinished, test, vi } from "vitest";
import { TypingIndicatorManager } from "./typing-indicator.ts";

test("TypingIndicatorManager delays the first typing indicator by 1s", async () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });

  const send = vi.fn(async () => undefined);
  const manager = new TypingIndicatorManager({
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

test("TypingIndicatorManager clears the delayed typing indicator on stop", async () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });

  const send = vi.fn(async () => undefined);
  const manager = new TypingIndicatorManager({
    send,
    logLabel: "[test]",
  });

  manager.start();
  manager.stop();

  await vi.advanceTimersByTimeAsync(1000);
  expect(send).not.toHaveBeenCalled();
});
