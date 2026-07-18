import type { AgentSessionUsage, StateSession } from "../../state.ts";
import { formatTime } from "../../utils/index.ts";
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

type ParsedSessionNew = {
  target?: string;
  agentKey?: string;
  agentSessionKey?: string;
};

export function parseSessionTarget(args: string[]): ParsedTargetOption {
  if (args[0] === "--target") {
    const target = args[1];
    if (!target) {
      throw new Error("Missing value for --target");
    }
    args = args.slice(2);
    return { target, args };
  }
  return { args };
}

export function parseSessionNew(args: string[]): ParsedSessionNew {
  const result: ParsedSessionNew = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--target" || arg === "--agent-session") {
      const value = args[++index];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      if (arg === "--target") {
        if (result.target) {
          throw new Error("Duplicate option: --target");
        }
        result.target = value;
      } else {
        if (result.agentSessionKey) {
          throw new Error("Duplicate option: --agent-session");
        }
        result.agentSessionKey = value;
      }
      continue;
    }
    if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (result.agentKey) {
      throw new Error(`Invalid argument: ${arg}`);
    }
    result.agentKey = arg;
  }
  return result;
}

export function parseSessionConfig(rawArgs: string[]): ParsedSessionConfig {
  const { target, args } = parseSessionTarget(rawArgs);

  if (args.length === 0) {
    return { target };
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
    target,
    patch,
  };
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
  activeTurn?: boolean;
}): string {
  let lines = [
    `session: ${options.name}`,
    `agent: ${options.session.agentKey}`,
    `agent session id: ${options.session.agentSessionId ?? "none"}`,
    renderSessionUpdatedAt(options.session.updatedAt, options.timezone),
    `verbose: ${options.session.verbose}`,
    `renew: ${renderSessionRenewPolicy({
      policy: options.session.renew,
      timezone: options.timezone,
    })}`,
  ];
  if (options.activeTurn !== undefined) {
    lines.push(`active turn: ${options.activeTurn ? "yes" : "no"}`);
  }
  if (options.usage) {
    lines.push(renderSessionContextUsage(options.usage));
  }
  if (options.indent) {
    lines = lines.map((line) => `${options.indent}${line}`);
  }
  return lines.join("\n");
}

export function renderSessionUpdatedAt(updatedAt: number | undefined, timezone: string): string {
  const value = updatedAt === undefined ? "none" : formatTime(updatedAt, timezone);
  return `updated at: ${value}`;
}

function renderSessionContextUsage(usage: AgentSessionUsage): string {
  const pct = Math.round((usage.used / usage.size) * 100);
  return `context: ${usage.used} / ${usage.size} tokens (${pct}%)`;
}
