type ParsedCli = {
  command: string;
  args: string[];
  envFile?: string;
};

export function parseCli(options: {
  argv: string[];
  commands: string[];
  defaultCommand?: string;
}): ParsedCli {
  let envFile: string | undefined;
  let index = 0;
  while (index < options.argv.length) {
    const token = options.argv[index];
    if (token === "-h" || token === "--help") {
      return {
        command: "help",
        args: [],
      };
    }
    if (token === "--env-file") {
      const value = options.argv[index + 1];
      if (!value) {
        throw new Error("Missing value for --env-file");
      }
      envFile = value;
      index += 2;
      continue;
    }
    break;
  }

  const [inputCommand, ...args] = options.argv.slice(index);
  const command = inputCommand ?? options.defaultCommand;

  if (!command) {
    throw new Error("Missing command");
  }
  if (!options.commands.includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }
  return {
    command,
    args,
    envFile,
  };
}
