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
  let argsStart = 0;
  const firstArg = options.argv[0];
  if (firstArg === "-h" || firstArg === "--help") {
    return {
      command: "help",
      args: [],
    };
  }
  if (firstArg === "--env-file") {
    const value = options.argv[1];
    if (!value) {
      throw new Error("Missing value for --env-file");
    }
    envFile = value;
    argsStart = 2;
  }

  const [inputCommand, ...args] = options.argv.slice(argsStart);
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
