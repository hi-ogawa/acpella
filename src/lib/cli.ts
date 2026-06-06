type ParsedCli = {
  command: string;
  args: string[];
  envFile?: string;
  channel?: string;
};

export function parseCli(options: {
  argv: string[];
  commands: string[];
  defaultCommand?: string;
}): ParsedCli {
  let envFile: string | undefined;
  let channel: string | undefined;
  const argv: string[] = [];
  const input = [...options.argv];
  while (input.length > 0) {
    const arg = input.shift()!;
    if (arg.startsWith("--env-file=")) {
      const value = arg.slice("--env-file=".length);
      if (!value) {
        throw new Error("Missing value for --env-file");
      }
      envFile = value;
      continue;
    }
    if (arg.startsWith("--channel=")) {
      const value = arg.slice("--channel=".length);
      if (!value) {
        throw new Error("Missing value for --channel");
      }
      channel = value;
      continue;
    }
    argv.push(arg);
  }

  const command = argv[0] ?? options.defaultCommand;
  const args = argv.slice(1);

  if (!command) {
    throw new Error("Missing command");
  }
  if (!options.commands.includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }
  return {
    command,
    args,
    ...(envFile ? { envFile } : {}),
    ...(channel ? { channel } : {}),
  };
}
