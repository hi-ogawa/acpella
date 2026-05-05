import type { AgentSessionUsage, StateSession } from "../../state.ts";
import { parseSessionRenewPolicy, renderSessionRenewPolicy } from "./renew.ts";
import { parseVerboseMode } from "./verbose.ts";

type SessionConfigPatch = Pick<Partial<StateSession>, "verbose" | "renew">;

type ParsedSessionConfig = {
  target?: string;
  patch?: SessionConfigPatch;
};

export function parseSessionConfig(args: string[]): ParsedSessionConfig {
  let target: string | undefined;

  if (args[0] === "--target") {
    target = args[1];
    if (!target) {
      throw new Error("Missing value for --target");
    }
    args = args.slice(2);
  }

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

function renderSessionContextUsage(usage: AgentSessionUsage): string {
  const pct = Math.round((usage.used / usage.size) * 100);
  return `context: ${usage.used} / ${usage.size} tokens (${pct}%)`;
}

export function renderSessionInfo(options: {
  name: string;
  session: StateSession;
  usage?: AgentSessionUsage;
  indent?: string;
  timezone: string;
}): string {
  const lines = [
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
    return lines.map((line) => `${options.indent}${line}`).join("\n");
  }
  return lines.join("\n");
}
