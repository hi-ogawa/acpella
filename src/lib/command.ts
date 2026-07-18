export type CommandTree<T> = Record<string, CommandSpec<T>[]>;

type CommandSpec<T> = {
  tokens: string[];
  usage: string;
  description: string;
  withArgs?: boolean;
  withBody?: boolean;
  run: (context: CommandRunContext<T>) => Promise<void>;
};

type CommandRunContext<T> = T & {
  args: string[];
  body?: string;
  usage: string;
};

interface CommandHandlerOptions<T> {
  commands: CommandTree<T>;
  onUsage: (usage: string, context: T) => Promise<void>;
}

type CommandInput = {
  tokens: string[];
  headTokens: string[];
  body?: string;
};

export class CommandHandler<T> {
  options: CommandHandlerOptions<T>;
  help: ReturnType<typeof buildHelp>;

  constructor(options: CommandHandlerOptions<T>) {
    this.options = options;
    this.help = buildHelp(options.commands);
  }

  async handle({ text, context }: { text: string; context: T }): Promise<boolean> {
    const input = parseCommandInput(text);
    if (!input) {
      return false;
    }
    const { tokens } = input;
    const [commandName, ...subcommandTokens] = tokens;
    if (commandName === "help") {
      await this.options.onUsage(this.help.full, context);
      return true;
    }

    const commandGroup = this.options.commands[commandName];
    if (!commandGroup) {
      return false;
    }

    const matched = findCommand(commandGroup, {
      tokens: subcommandTokens,
      headTokens: input.headTokens.slice(1),
      body: input.body,
    });
    if (!matched) {
      await this.options.onUsage(this.help.byCommand[commandName]!, context);
      return true;
    }

    const runContext: CommandRunContext<T> = {
      ...context,
      args: matched.args,
      usage: `Usage: ${matched.command.usage}`,
    };
    if (matched.command.withBody && input.body !== undefined) {
      runContext.body = input.body;
    }
    await matched.command.run(runContext);
    return true;
  }
}

function parseCommandInput(text: string): CommandInput | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return;
  }
  const input = trimmed.slice(1);
  const separator = /\s--(?:\s|$)/.exec(input);
  const head = separator ? input.slice(0, separator.index) : input;
  const tokens = input.split(/\s+/);
  if (!tokens[0]) {
    return;
  }
  const result: CommandInput = {
    tokens,
    headTokens: head.split(/\s+/),
  };
  if (separator) {
    result.body = input.slice(separator.index + separator[0].length);
  }
  return result;
}

function findCommand<T>(commands: CommandSpec<T>[], input: CommandInput) {
  for (const command of commands) {
    const tokens = command.withBody ? input.headTokens : input.tokens;
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
