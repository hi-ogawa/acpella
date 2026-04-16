export type CommandSpec<TContext> = {
  path: string[];
  usage: string;
  summary: string;
  run: (context: CommandRunContext<TContext>) => Promise<void> | void;
};

export type CommandTree<TContext> = Record<string, CommandSpec<TContext>[]>;

export type CommandInvocation = {
  command: string;
  path: string[];
  args: string[];
  rawArgs: string;
};

export type CommandRunContext<TContext> = TContext & {
  invocation: CommandInvocation;
};

export async function handleCommand<TContext>(options: {
  text: string;
  commands: CommandTree<TContext>;
  context: TContext;
  onUsage: (usage: string, context: TContext) => Promise<void> | void;
}): Promise<boolean> {
  const invocation = parseCommand(options.text);
  if (!invocation) {
    return false;
  }

  const commandGroup = options.commands[invocation.command];
  if (!commandGroup) {
    return false;
  }

  const matched = findCommand(commandGroup, invocation);
  if (!matched) {
    await options.onUsage(renderCommandUsage(commandGroup), options.context);
    return true;
  }

  await matched.command.run({
    ...options.context,
    invocation: matched.invocation,
  });
  return true;
}

function parseCommand(text: string): CommandInvocation | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return undefined;
  }
  const [command, ...path] = trimmed.slice(1).split(/\s+/);
  if (!command) {
    return undefined;
  }
  return {
    command,
    path,
    args: path,
    rawArgs: path.join(" "),
  };
}

function findCommand<TContext>(
  commands: CommandSpec<TContext>[],
  invocation: CommandInvocation,
):
  | {
      command: CommandSpec<TContext>;
      invocation: CommandInvocation;
    }
  | undefined {
  for (const command of commands) {
    if (!equalPath(invocation.path, command.path)) {
      continue;
    }

    return {
      command,
      invocation: {
        command: invocation.command,
        path: command.path,
        args: [],
        rawArgs: "",
      },
    };
  }
  return undefined;
}

function equalPath(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((segment, index) => right[index] === segment);
}

function renderCommandUsage<TContext>(commands: CommandSpec<TContext>[]): string {
  const usages = commands.map((command) => command.usage);
  if (usages.length === 1) {
    return `Usage: ${usages[0]}`;
  }
  return `Usage:\n${usages.join("\n")}`;
}
