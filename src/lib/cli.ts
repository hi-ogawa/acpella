import { Result } from "./utils.ts";

type ParsedCli = {
  command: string;
  args: string[];
};

export function parseCli(options: {
  argv: string[];
  commands: string[];
  defaultCommand?: string;
}): Result<ParsedCli, string> {
  const [inputCommand, ...args] = options.argv.slice(2);
  const command = inputCommand ?? options.defaultCommand;

  if (command === "-h" || command === "--help") {
    return Result.ok({
      command: "help",
      args: [],
    });
  }
  if (!command) {
    return Result.err("Missing command");
  }
  if (!options.commands.includes(command)) {
    return Result.err(`Unknown command: ${command}`);
  }
  return Result.ok({
    command,
    args,
  });
}
