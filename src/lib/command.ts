export type CommandSpec<T> = {
  path: string[];
  usage: string;
  summary: string;
  run: (context: CommandRunContext<T>) => Promise<void> | void;
};

export type CommandTree<T> = Record<string, CommandSpec<T>[]>;

export type CommandInvocation = {
  command: string;
  path: string[];
  args: string[];
  rawArgs: string;
};

export type CommandRunContext<T> = T & {
  invocation: CommandInvocation;
};

export function createCommandHandler<T>(options: {
  commands: CommandTree<T>;
  onUsage: (usage: string, context: T) => Promise<void> | void;
}) {
  const usageByCommand = buildUsageByCommand(options.commands);

  return {
    async handle(handleOptions: { text: string; context: T }): Promise<boolean> {
      const invocation = parseCommand(handleOptions.text);
      if (!invocation) {
        return false;
      }

      const commandGroup = options.commands[invocation.command];
      if (!commandGroup) {
        return false;
      }

      const matched = findCommand(commandGroup, invocation);
      if (!matched) {
        await options.onUsage(usageByCommand[invocation.command]!, handleOptions.context);
        return true;
      }

      await matched.command.run({
        ...handleOptions.context,
        invocation: matched.invocation,
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

function findCommand<T>(
  commands: CommandSpec<T>[],
  invocation: CommandInvocation,
):
  | {
      command: CommandSpec<T>;
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

function renderCommandUsage<T>(commands: CommandSpec<T>[]): string {
  const usages = commands.map((command) => command.usage);
  if (usages.length === 1) {
    return `Usage: ${usages[0]}`;
  }
  return `Usage:\n${usages.join("\n")}`;
}
