type ChannelAddress = {
  channel: "discord";
  kind: "forum";
  id: string;
};

// The prefix routes to a channel adapter; the rest is that adapter's own
// convention using the platform's glossary (e.g. discord:forum:<channel-id>).
// Bare `discord:<id>` stays reserved for session names.
export function parseChannelAddress(input: string): ChannelAddress {
  const match = /^discord:forum:(\d+)$/.exec(input);
  if (!match) {
    throw new Error(`\
Invalid channel address: ${input}
Supported: discord:forum:<forum-channel-id>`);
  }
  return { channel: "discord", kind: "forum", id: match[1]! };
}

export function parseChannelNewSessionArgs(options: { args: string[]; text: string }): {
  address: ChannelAddress;
  title: string;
  text: string;
} {
  const [addressArg, ...rest] = options.args;
  if (!addressArg) {
    throw new Error("Missing channel address");
  }
  const address = parseChannelAddress(addressArg);

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

  return { address, title, text: rawText };
}
