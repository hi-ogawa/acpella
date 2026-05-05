import type { StateSessionPatch } from "../../state.ts";
import { parseSessionRenewPolicy, renderSessionRenewPolicy } from "../session-renew.ts";
import { parseVerboseMode } from "../verbose.ts";

type SessionConfigPatch = Pick<StateSessionPatch, "verbose" | "renew">;

type ParsedSessionConfig = {
  targetSessionName?: string;
  patch?: SessionConfigPatch;
};

export function parseSessionConfig(args: string[]): ParsedSessionConfig {
  let configArgs = args;
  let targetSessionName: string | undefined;

  if (args[0] === "--target") {
    targetSessionName = args[1];
    if (!targetSessionName) {
      throw new Error("Missing value for --target");
    }
    configArgs = args.slice(2);
  }

  let patch: SessionConfigPatch | undefined;
  for (const arg of configArgs) {
    const eqIdx = arg.indexOf("=");
    if (eqIdx === -1) {
      throw new Error(`Invalid argument: ${arg}\nExpected key=value pairs.`);
    }

    const key = arg.slice(0, eqIdx);
    const value = arg.slice(eqIdx + 1);

    switch (key) {
      case "verbose": {
        patch ??= {};
        patch.verbose = parseVerboseMode(value);
        break;
      }
      case "renew": {
        patch ??= {};
        patch.renew = value === "" ? undefined : parseSessionRenewPolicy(value);
        break;
      }
      default: {
        throw new Error(`Unknown key: ${key}\nSupported keys: renew, verbose`);
      }
    }
  }

  return {
    targetSessionName,
    patch,
  };
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
