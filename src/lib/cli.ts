type ParsedCli = {
  command: string;
  args: string[];
};

export function parseCli(options: {
  argv: string[];
  commands: string[];
  defaultCommand?: string;
}): ParsedCli {
  const [inputCommand, ...args] = options.argv.slice(2);
  const command = inputCommand ?? options.defaultCommand;

  if (command === "-h" || command === "--help") {
    return {
      command: "help",
      args: [],
    };
  }
  if (!command) {
    throw new Error("Missing command");
  }
  if (!options.commands.includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }
  return {
    command,
    args,
  };
}
