import { parseSessionRenewPolicy, renderSessionRenewPolicy } from "../session-renew.ts";
import { parseVerboseMode } from "../verbose.ts";

export type SessionConfigPatch = {
  verbose?: ReturnType<typeof parseVerboseMode>;
  renew?: ReturnType<typeof parseSessionRenewPolicy>;
};

export type ParsedSessionConfigArgs = {
  targetSessionName?: string;
  configArgs: string[];
};

export function parseSessionConfigArgs(args: string[]): ParsedSessionConfigArgs {
  if (args[0] !== "--target") {
    return { configArgs: args };
  }

  const targetSessionName = args[1];
  if (!targetSessionName) {
    throw new Error("Missing value for --target");
  }

  return {
    targetSessionName,
    configArgs: args.slice(2),
  };
}

export function parseSessionConfigPatch(args: string[]): SessionConfigPatch {
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
        patch.renew = value === "" ? undefined : parseSessionRenewPolicy(value);
        break;
      }
      default: {
        throw new Error(`Unknown key: ${key}\nSupported keys: renew, verbose`);
      }
    }
  }

  return patch;
}

export function renderSessionConfig(options: {
  session: SessionConfigPatch;
  timezone: string;
}): string {
  return `verbose: ${options.session.verbose}\nrenew: ${renderSessionRenewPolicy({
    policy: options.session.renew,
    timezone: options.timezone,
  })}`;
}
