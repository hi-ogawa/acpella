// TODO: review slop

export type CommandTree<T> = Record<string, CommandSpec<T>[]>;

export type CommandSpec<T> = {
  path: string[]; // TODO: optional?
  usage: string;
  summary: string;
  match?: "exact" | "prefix";
  run: (context: CommandRunContext<T>) => Promise<void>;
};

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
  onUsage: (usage: string, context: T) => Promise<void>;
}) {
  const usageByCommand = buildUsageByCommand(options.commands);
  const commandOverview = renderCommandOverview(options.commands);

  return {
    async handle(handleOptions: { text: string; context: T }): Promise<boolean> {
      const invocation = parseCommand(handleOptions.text);
      if (!invocation) {
        return false;
      }
      if (invocation.command === "help") {
        await options.onUsage(commandOverview, handleOptions.context);
        return true;
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
    return;
  }
  const [command, ...path] = trimmed.slice(1).split(/\s+/);
  if (!command) {
    return;
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
    if (!matchesPath({ path: invocation.path, command })) {
      continue;
    }
    const args = invocation.path.slice(command.path.length);

    return {
      command,
      invocation: {
        command: invocation.command,
        path: command.path,
        args,
        rawArgs: args.join(" "),
      },
    };
  }
  return;
}

function matchesPath<T>(options: { path: string[]; command: CommandSpec<T> }): boolean {
  if (options.command.match === "prefix") {
    return startsWithPath(options.path, options.command.path);
  }
  return equalPath(options.path, options.command.path);
}

function startsWithPath(path: string[], prefix: string[]): boolean {
  return prefix.every((segment, index) => path[index] === segment);
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
