export type CommandTree<T> = Record<string, CommandSpec<T>[]>;

export type CommandSpec<T> = {
  tokens: string[];
  help: string;
  withArgs?: boolean;
  run: (context: CommandRunContext<T>) => Promise<void>;
};

export type CommandRunContext<T> = T & {
  args: string[];
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
        args: matched.args,
      });
      return true;
    },
  };
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

function findCommand<T>(commands: CommandSpec<T>[], tokens: string[]) {
  for (const command of commands) {
    if (matchesTokens(command, tokens)) {
      return {
        command,
        args: tokens.slice(command.tokens.length),
      };
    }
  }
}

function matchesTokens<T>(command: CommandSpec<T>, tokens: string[]): boolean {
  if (command.withArgs) {
    return isPrefixArray(command.tokens, tokens);
  }
  return isEqualArray(command.tokens, tokens);
}

function isPrefixArray(left: string[], right: string[]): boolean {
  return left.every((s, index) => s === right[index]);
}

function isEqualArray(left: string[], right: string[]): boolean {
  return left.length === right.length && isPrefixArray(left, right);
}

function buildUsageByCommand<T>(commands: CommandTree<T>): Record<string, string> {
  const usageByCommand: Record<string, string> = {};
  for (const [command, commandGroup] of Object.entries(commands)) {
    usageByCommand[command] = renderCommandUsage(commandGroup);
  }
  return usageByCommand;
}

function renderCommandUsage<T>(commands: CommandSpec<T>[]): string {
  const usages = commands.map((command) => getCommandUsage(command));
  if (usages.length === 1) {
    return `Usage: ${usages[0]}`;
  }
  return `Usage:\n${usages.join("\n")}`;
}

function getCommandUsage<T>(command: CommandSpec<T>): string {
  return command.help.split(" - ", 1)[0]!;
}

function renderCommandOverview<T>(commands: CommandTree<T>): string {
  let output = "Commands:\n/help - Show command help.";
  for (const [command, commandGroup] of Object.entries(commands)) {
    output += `\n\n/${command}`;
    for (const commandSpec of commandGroup) {
      output += `\n  ${commandSpec.help}`;
    }
  }
  return output;
}
