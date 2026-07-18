// Per-process implementations of `/channel` commands, wired via `createHandler` options.
export type ChannelCommands = {
  // Runs `/channel new-session` given the raw command input; returns the reply text.
  newSession: (options: { args: string[]; text: string }) => Promise<{ reply: string }>;
};

// Returning `undefined` means the implementation does not recognize the
// address (another channel's), as opposed to failing to handle its own.
export type CreateChannelSession = (options: {
  address: string;
  title: string;
  text: string;
}) => Promise<{ reply: string } | undefined>;

export function parseChannelNewSessionArgs(options: { args: string[]; text: string }): {
  address: string;
  title: string;
  text: string;
} {
  const [address, ...rest] = options.args;
  if (!address) {
    throw new Error("Missing channel address");
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

  return { address, title, text: rawText };
}
