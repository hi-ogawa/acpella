import { expect, test } from "vitest";
import { parseDiscordSendMessageArgs } from "./commands.ts";

test("parses send-message arguments with a multiline body", () => {
  expect(
    parseDiscordSendMessageArgs({
      head: ["123"],
      body: "first\n\nsecond -- later",
    }),
  ).toEqual({
    channelId: "123",
    text: "first\n\nsecond -- later",
  });
  expect(() => parseDiscordSendMessageArgs({ head: ["123"], body: undefined })).toThrow(
    "Missing `-- <text>`",
  );
});
