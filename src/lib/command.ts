export type CommandTree<T> = Record<string, CommandSpec<T>[]>;

type CommandSpec<T> = {
  tokens: string[];
  usage: string;
  description: string;
  withArgs?: boolean;
  run: (context: CommandRunContext<T>) => Promise<void>;
};

type CommandRunContext<T> = T & {
  args: string[];
  usage: string;
  splitArgs: SplitArgs;
};

interface CommandHandlerOptions<T> {
  commands: CommandTree<T>;
  onUsage: (usage: string, context: T) => Promise<void>;
}

export type SplitArgs = {
  head: string[];
  body: string | undefined;
};

type ParsedCommand = {
  tokens: string[];
  splitArgs: SplitArgs;
};

export class CommandHandler<T> {
  options: CommandHandlerOptions<T>;
  help: ReturnType<typeof buildHelp>;

  constructor(options: CommandHandlerOptions<T>) {
    this.options = options;
    this.help = buildHelp(options.commands);
  }

  async handle({ text, context }: { text: string; context: T }): Promise<boolean> {
    const parsed = parseCommand(text);
    if (!parsed) {
      return false;
    }
    const { tokens } = parsed;
    const [commandName, ...subcommandTokens] = tokens;
    if (commandName === "help") {
      await this.options.onUsage(this.help.full, context);
      return true;
    }

    const commandGroup = this.options.commands[commandName];
    if (!commandGroup) {
      return false;
    }

    const command = findCommand(commandGroup, subcommandTokens);
    if (!command) {
      await this.options.onUsage(this.help.byCommand[commandName]!, context);
      return true;
    }
    await command.run({
      ...context,
      args: tokens.slice(1 + command.tokens.length),
      usage: `Usage: ${command.usage}`,
      splitArgs: {
        head: parsed.splitArgs.head.slice(1 + command.tokens.length),
        body: parsed.splitArgs.body,
      },
    });
    return true;
  }
}

function parseCommand(text: string): ParsedCommand | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return;
  }
  const commandText = trimmed.slice(1);
  const tokens = commandText.split(/\s+/);
  if (!tokens[0]) {
    return;
  }
  const result: ParsedCommand = {
    tokens,
    splitArgs: { head: tokens, body: undefined },
  };
  const separator = /\s--(?:\s|$)/.exec(commandText);
  if (separator) {
    result.splitArgs = {
      head: commandText.slice(0, separator.index).split(/\s+/),
      body: commandText.slice(separator.index + separator[0].length),
    };
  }
  return result;
}

function findCommand<T>(commands: CommandSpec<T>[], tokens: string[]) {
  for (const command of commands) {
    if (matchesTokens(command, tokens)) {
      return command;
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

function buildHelp(tree: CommandTree<any>) {
  const byCommand: Record<string, string> = {};
  for (const [command, subCommands] of Object.entries(tree)) {
    byCommand[command] = `\
/${command}
${subCommands.map((c) => `  ${c.usage} - ${c.description}`).join("\n")}
`;
  }
  const full = `\
Commands:
/help - Show command help.

${Object.values(byCommand).join("\n")}
`;
  return { full, byCommand };
}
