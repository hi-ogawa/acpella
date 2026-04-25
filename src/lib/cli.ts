import { Result } from "./utils.ts";

type ParsedCli = {
  command: string;
  args: string[];
  envFile?: string;
};

export function parseCli(options: {
  argv: string[];
  commands: string[];
  defaultCommand?: string;
}): Result<ParsedCli, string> {
  let envFile: string | undefined;
  let index = 2;
  while (index < options.argv.length) {
    const token = options.argv[index];
    if (token === "-h" || token === "--help") {
      return Result.ok({
        command: "help",
        args: [],
      });
    }
    if (token === "--env-file") {
      const value = options.argv[index + 1];
      if (!value) {
        return Result.err("Missing value for --env-file");
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
    return Result.err("Missing command");
  }
  if (!options.commands.includes(command)) {
    return Result.err(`Unknown command: ${command}`);
  }
  return Result.ok({
    command,
    args,
    envFile,
  });
}
