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
  const argv = [...options.argv];
  if (argv[0] === "--env-file") {
    const value = argv[1];
    if (!value) {
      throw new Error("Missing value for --env-file");
    }
    envFile = value;
    argv.splice(0, 2);
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
    envFile,
  };
}
