import { expect, test } from "vitest";
import { normalizeUserMention } from "./utils.ts";

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
