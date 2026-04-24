import { toResult, type Result } from "./utils";

type ParsedCli = {
  command: string;
  args: string[];
};

export function parseCli(options: {
  argv: string[];
  commands: string[];
}): Result<ParsedCli, string> {
  const [command, ...args] = options.argv.slice(2);
  if (["-h", "--help"].includes(command)) {
    return toResult.ok({
      command: "help",
      args: [],
    });
  }
  if (!options.commands.includes(command)) {
    return toResult.err(`Unknown command: ${command}`);
  }
  return toResult.ok({
    command,
    args,
  });
}
