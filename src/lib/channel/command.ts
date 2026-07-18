type ChannelAddress = {
  channel: string;
  kind: string;
  id: string;
};

export type CreateChannelSession = (options: {
  address: ChannelAddress;
  title: string;
  text: string;
}) => Promise<{ sessionName: string; url: string }>;

// The prefix routes to a channel adapter; the rest is that adapter's own
// convention using the platform's glossary (e.g. discord:forum:<channel-id>).
// Bare `discord:<id>` stays reserved for session names. Which addresses are
// actually supported is up to the wired `CreateChannelSession` implementation.
export function parseChannelAddress(input: string): ChannelAddress {
  const match = /^([a-z]+):([a-z-]+):(.+)$/.exec(input);
  if (!match) {
    throw new Error(`\
Invalid channel address: ${input}
Expected: <channel>:<kind>:<id>`);
  }
  return { channel: match[1]!, kind: match[2]!, id: match[3]! };
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
