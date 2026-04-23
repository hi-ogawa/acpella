export type CommandTree<T> = Record<string, CommandSpec<T>[]>;

export type CommandSpec<T> = {
  tokens: string[];
  help: string;
  withArgs?: boolean;
  run: (context: CommandRunContext<T>) => Promise<void>;
};

type CommandRunContext<T> = T & {
  args: string[];
};

interface CommandHandlerOptions<T> {
  commands: CommandTree<T>;
  onUsage: (usage: string, context: T) => Promise<void>;
}

export class CommandHandler<T> {
  options: CommandHandlerOptions<T>;
  help: ReturnType<typeof buildHelp>;

  constructor(options: CommandHandlerOptions<T>) {
    this.options = options;
    this.help = buildHelp(options.commands);
  }

  async handle({ text, context }: { text: string; context: T }): Promise<boolean> {
    const tokens = parseCommandTokens(text);
    if (!tokens) {
      return false;
    }
    const [commandName, ...subcommandTokens] = tokens;
    if (commandName === "help") {
      await this.options.onUsage(this.help.full, context);
      return true;
    }

    const commandGroup = this.options.commands[commandName];
    if (!commandGroup) {
      return false;
    }

    const matched = findCommand(commandGroup, subcommandTokens);
    if (!matched) {
      await this.options.onUsage(this.help.byCommand[commandName]!, context);
      return true;
    }

    await matched.command.run({
      ...context,
      args: matched.args,
    });
    return true;
  }
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

function buildHelp(tree: CommandTree<any>) {
  const byCommand: Record<string, string> = {};
  for (const [command, subCommands] of Object.entries(tree)) {
    byCommand[command] = `\
/${command}
${subCommands.map((c) => `  ${c.help}`).join("\n")}
`;
  }
  const full = `\
Commands:
/help - Show command help.

${Object.values(byCommand).join("\n")}
`;
  return { full, byCommand };
}
