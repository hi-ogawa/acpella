// TODO: review slop

export type CommandTree<T> = Record<string, CommandSpec<T>[]>;

export type CommandSpec<T> = {
  tokens: string[];
  usage: string;
  summary: string;
  match?: "prefix";
  run: (context: CommandRunContext<T>) => Promise<void>;
};

export type CommandInvocation = {
  command: string;
  args: string[];
};

export type CommandRunContext<T> = T & {
  invocation: CommandInvocation;
};

export function createCommandHandler<T>(options: {
  commands: CommandTree<T>;
  onUsage: (usage: string, context: T) => Promise<void>;
}) {
  const usageByCommand = buildUsageByCommand(options.commands);
  const commandOverview = renderCommandOverview(options.commands);

  return {
    async handle(handleOptions: { text: string; context: T }): Promise<boolean> {
      const tokens = parseCommandTokens(handleOptions.text);
      if (!tokens) {
        return false;
      }
      const [commandName, ...subcommandTokens] = tokens;
      if (commandName === "help") {
        await options.onUsage(commandOverview, handleOptions.context);
        return true;
      }

      const commandGroup = options.commands[commandName];
      if (!commandGroup) {
        return false;
      }

      const matched = findCommand(commandGroup, subcommandTokens);
      if (!matched) {
        await options.onUsage(usageByCommand[commandName]!, handleOptions.context);
        return true;
      }

      await matched.command.run({
        ...handleOptions.context,
        invocation: {
          command: commandName,
          args: matched.args,
        },
      });
      return true;
    },
  };
}

function buildUsageByCommand<T>(commands: CommandTree<T>): Record<string, string> {
  const usageByCommand: Record<string, string> = {};
  for (const [command, commandGroup] of Object.entries(commands)) {
    usageByCommand[command] = renderCommandUsage(commandGroup);
  }
  return usageByCommand;
}

function parseCommandTokens(text: string): string[] | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return;
  }
  const tokens = trimmed.slice(1).split(/\s+/);
  if (!tokens[0]) {
    return;
  }
  return tokens;
}

function findCommand<T>(
  commands: CommandSpec<T>[],
  tokens: string[],
):
  | {
      command: CommandSpec<T>;
      args: string[];
    }
  | undefined {
  for (const command of commands) {
    if (!matchesTokens({ tokens, command })) {
      continue;
    }
    const args = tokens.slice(command.tokens.length);

    return {
      command,
      args,
    };
  }
  return;
}

function matchesTokens<T>(options: { tokens: string[]; command: CommandSpec<T> }): boolean {
  if (options.command.match === "prefix") {
    return startsWithTokens(options.tokens, options.command.tokens);
  }
  return equalTokens(options.tokens, options.command.tokens);
}

function startsWithTokens(tokens: string[], prefix: string[]): boolean {
  return prefix.every((segment, index) => tokens[index] === segment);
}

function equalTokens(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((segment, index) => right[index] === segment);
}

function renderCommandUsage<T>(commands: CommandSpec<T>[]): string {
  const usages = commands.map((command) => command.usage);
  if (usages.length === 1) {
    return `Usage: ${usages[0]}`;
  }
  return `Usage:\n${usages.join("\n")}`;
}

function renderCommandOverview<T>(commands: CommandTree<T>): string {
  let output = "Commands:\n/help - Show command help.";
  for (const [command, commandGroup] of Object.entries(commands)) {
    output += `\n\n/${command}`;
    for (const commandSpec of commandGroup) {
      output += `\n  ${commandSpec.usage} - ${commandSpec.summary}`;
    }
  }
  return output;
}
