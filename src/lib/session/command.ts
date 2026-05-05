import type { AgentSessionUsage, StateSession } from "../../state.ts";
import { parseSessionRenewPolicy, renderSessionRenewPolicy } from "./renew.ts";
import { parseVerboseMode } from "./verbose.ts";

type ParsedTargetOption = {
  target?: string;
  args: string[];
};

type SessionConfigPatch = Pick<Partial<StateSession>, "verbose" | "renew">;

type ParsedSessionConfig = {
  target?: string;
  patch?: SessionConfigPatch;
};

export function parseTargetOption(args: string[]): ParsedTargetOption {
  if (args[0] !== "--target") {
    return { args };
  }
  const target = args[1];
  if (!target) {
    throw new Error("Missing value for --target");
  }
  return {
    target,
    args: args.slice(2),
  };
}

export function parseSessionConfig(args: string[]): ParsedSessionConfig {
  const parsedTarget = parseTargetOption(args);
  args = parsedTarget.args;

  if (args.length === 0) {
    return { target: parsedTarget.target };
  }

  const patch: SessionConfigPatch = {};
  for (const arg of args) {
    const eqIdx = arg.indexOf("=");
    if (eqIdx === -1) {
      throw new Error(`Invalid argument: ${arg}\nExpected key=value pairs.`);
    }

    const key = arg.slice(0, eqIdx);
    const value = arg.slice(eqIdx + 1);

    switch (key) {
      case "verbose": {
        patch.verbose = parseVerboseMode(value);
        break;
      }
      case "renew": {
        patch.renew = parseSessionRenewPolicy(value);
        break;
      }
      default: {
        throw new Error(`Unknown key: ${key}\nSupported keys: renew, verbose`);
      }
    }
  }

  return {
    target: parsedTarget.target,
    patch,
  };
}

export function parseSessionTarget(args: string[]) {
  const parsedTarget = parseTargetOption(args);
  if (parsedTarget.args.length > 0) {
    throw new Error(`Invalid argument: ${parsedTarget.args[0]}`);
  }
  return parsedTarget;
}

export function renderSessionConfig(options: {
  session: SessionConfigPatch;
  timezone: string;
}): string {
  return `\
verbose: ${options.session.verbose}
renew: ${renderSessionRenewPolicy({
    policy: options.session.renew,
    timezone: options.timezone,
  })}
`;
}

export function renderSessionInfo(options: {
  name: string;
  session: StateSession;
  usage?: AgentSessionUsage;
  timezone: string;
  indent?: string;
}): string {
  let lines = [
    `session: ${options.name}`,
    `agent: ${options.session.agentKey}`,
    `agent session id: ${options.session.agentSessionId ?? "none"}`,
    `verbose: ${options.session.verbose}`,
    `renew: ${renderSessionRenewPolicy({
      policy: options.session.renew,
      timezone: options.timezone,
    })}`,
  ];
  if (options.usage) {
    lines.push(renderSessionContextUsage(options.usage));
  }
  if (options.indent) {
    lines = lines.map((line) => `${options.indent}${line}`);
  }
  return lines.join("\n");
}

function renderSessionContextUsage(usage: AgentSessionUsage): string {
  const pct = Math.round((usage.used / usage.size) * 100);
  return `context: ${usage.used} / ${usage.size} tokens (${pct}%)`;
}
