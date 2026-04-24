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
  const tokens = options.argv.slice(2);
  let command: string | undefined;
  let envFile: string | undefined;
  const args: string[] = [];
  let parseOptions = true;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (parseOptions && token === "--") {
      parseOptions = false;
      continue;
    }
    if (parseOptions && token === "--env-file") {
      const value = tokens[index + 1];
      if (!value) {
        return Result.err("Missing value for --env-file");
      }
      envFile = value;
      index++;
      continue;
    }
    if (parseOptions && token.startsWith("--env-file=")) {
      const value = token.slice("--env-file=".length);
      if (!value) {
        return Result.err("Missing value for --env-file");
      }
      envFile = value;
      continue;
    }
    if (!command && (token === "-h" || token === "--help")) {
      return Result.ok({
        command: "help",
        args: [],
        ...(envFile ? { envFile } : {}),
      });
    }
    if (!command) {
      command = token;
      continue;
    }
    args.push(token);
  }

  command ??= options.defaultCommand;

  if (command === "-h" || command === "--help") {
    return Result.ok({
      command: "help",
      args: [],
      ...(envFile ? { envFile } : {}),
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
    ...(envFile ? { envFile } : {}),
  });
}
