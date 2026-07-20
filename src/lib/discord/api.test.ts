import { afterEach, expect, test, vi } from "vitest";
import { createDiscordMessage } from "./api.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("creates a marked deduplicated Discord message", async () => {
  const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    const form = init?.body as FormData;
    expect(JSON.parse(String(form.get("payload_json")))).toEqual({
      content: "first\n\nsecond",
      nonce: "acpella-prompt:123",
      enforce_nonce: true,
    });
    return Response.json({ id: "456" });
  });
  vi.stubGlobal("fetch", fetchMock);

  await expect(
    createDiscordMessage({
      token: "token",
      channelId: "123",
      text: "first\n\nsecond",
      nonce: "acpella-prompt:123",
      enforceNonce: true,
    }),
  ).resolves.toEqual({ messageId: "456" });
});
