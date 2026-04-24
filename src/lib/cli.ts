import { toResult, type Result } from "./utils.ts";

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
    return toResult.ok({
      command: "help" as any,
      args: [],
    });
  }
  if (!command) {
    return toResult.err("Missing command");
  }
  if (!options.commands.includes(command)) {
    return toResult.err(`Unknown command: ${command}`);
  }
  return toResult.ok({
    command: command as any,
    args,
  });
}
