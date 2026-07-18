import { createDiscordForumPost } from "./api.ts";
import { formatDiscordSessionName } from "./utils.ts";

export function parseDiscordNewSessionArgs(options: { args: string[]; text: string }): {
  channelId: string;
  title: string;
  text: string;
} {
  const [channelId, ...rest] = options.args;
  if (!channelId) {
    throw new Error("Missing forum channel id");
  }
  if (!/^\d+$/.test(channelId)) {
    throw new Error(`Invalid forum channel id: ${channelId}`);
  }

  const separatorIndex = rest.indexOf("--");
  if (separatorIndex === -1) {
    throw new Error("Missing `-- <text>`");
  }
  const title = rest.slice(0, separatorIndex).join(" ");
  if (!title) {
    throw new Error("Missing title");
  }

  // Take the text from the raw command string instead of the tokens, which
  // are whitespace-split and would collapse newlines in a multi-line handoff.
  const rawText = /\s--\s+([\s\S]+)$/.exec(options.text)?.[1]?.trim();
  if (!rawText) {
    throw new Error("Missing `-- <text>`");
  }

  return { channelId, title, text: rawText };
}

export async function handleDiscordNewSession(options: {
  token: string;
  args: string[];
  text: string;
}): Promise<string> {
  const parsed = parseDiscordNewSessionArgs(options);
  const result = await createDiscordForumPost({
    token: options.token,
    channelId: parsed.channelId,
    title: parsed.title,
    text: parsed.text,
  });
  return `\
Created discord forum post.
session: ${formatDiscordSessionName(result.threadId)}
url: ${result.url}`;
}
