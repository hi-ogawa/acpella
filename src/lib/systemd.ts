import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { env, getuid } from "node:process";

export interface SystemdUnitOptions {
  description: string;
  envFile: string;
  nodeBin: string;
  scope: "system" | "user";
  serviceName: string;
  user: string;
  workingDirectory: string;
}

export function defaultSystemdUnitOptions(): SystemdUnitOptions {
  const workingDirectory = process.cwd();
  return {
    description: "acpella service",
    envFile: resolve(workingDirectory, ".env"),
    nodeBin: process.execPath,
    scope: "user",
    serviceName: "acpella",
    user: defaultUser(),
    workingDirectory,
  };
}

export function runSystemdUnitCommand(options: { argv: string[] }): void {
  const defaults = defaultSystemdUnitOptions();
  if (options.argv.includes("--help") || options.argv.includes("-h")) {
    process.stdout.write(renderSystemdUnitHelp(defaults));
    return;
  }

  const unitOptions = parseSystemdUnitArgs({
    argv: options.argv,
    defaults,
  });

  process.stdout.write(renderSystemdUnit(unitOptions));
}

export function parseSystemdUnitArgs(options: {
  argv: string[];
  defaults: SystemdUnitOptions;
}): SystemdUnitOptions {
  const parsed = { ...options.defaults };

  for (let index = 0; index < options.argv.length; index += 1) {
    const arg = options.argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--system") {
      parsed.scope = "system";
      continue;
    }
    if (arg === "--user-unit") {
      parsed.scope = "user";
      continue;
    }

    const value = readOptionValue({ argv: options.argv, index });
    if (arg === "--description") {
      parsed.description = value.value;
    } else if (arg === "--env-file") {
      parsed.envFile = resolve(value.value);
    } else if (arg === "--node-bin") {
      parsed.nodeBin = resolve(value.value);
    } else if (arg === "--service-name") {
      parsed.serviceName = value.value;
    } else if (arg === "--user") {
      parsed.user = value.value;
    } else if (arg === "--working-directory") {
      parsed.workingDirectory = resolve(value.value);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
    index = value.index;
  }

  return parsed;
}

export function renderSystemdUnit(options: SystemdUnitOptions): string {
  const envLine = existsSync(options.envFile)
    ? `EnvironmentFile=${escapeSystemdValue(options.envFile)}\n`
    : `EnvironmentFile=-${escapeSystemdValue(options.envFile)}\n`;
  const userLine = options.scope === "system" ? `User=${escapeSystemdValue(options.user)}\n` : "";
  const installTarget = options.scope === "system" ? "multi-user.target" : "default.target";
  const networkLines =
    options.scope === "system" ? "After=network-online.target\nWants=network-online.target\n" : "";

  return `[Unit]
Description=${escapeSystemdValue(options.description)}
${networkLines}
[Service]
Type=simple
SyslogIdentifier=${escapeSystemdValue(options.serviceName)}
${userLine}WorkingDirectory=${escapeSystemdValue(options.workingDirectory)}
${envLine}ExecStart=${escapeSystemdValue(options.nodeBin)} ${escapeSystemdValue(resolve(options.workingDirectory, "src/index.ts"))}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=${installTarget}
`;
}

export function renderSystemdUnitHelp(defaults: SystemdUnitOptions): string {
  return `Usage: node src/index.ts generate-systemd-unit [options]

Print a systemd unit for this acpella checkout.

Options:
  --user-unit                 Generate a user unit. Default.
  --system                    Generate a system unit for /etc/systemd/system.
  --service-name <name>       Service name metadata. Default: ${defaults.serviceName}
  --description <text>        Unit description. Default: ${defaults.description}
  --user <user>               System unit service user. Default: ${defaults.user}
  --working-directory <path>  Project checkout. Default: ${defaults.workingDirectory}
  --env-file <path>           Environment file. Default: ${defaults.envFile}
  --node-bin <path>           Node executable. Default: ${defaults.nodeBin}
  -h, --help                  Show this help.
`;
}

function readOptionValue(options: { argv: string[]; index: number }): {
  index: number;
  value: string;
} {
  const value = options.argv[options.index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${options.argv[options.index]}`);
  }
  return { index: options.index + 1, value };
}

function escapeSystemdValue(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function defaultUser(): string {
  if (env.USER) {
    return env.USER;
  }
  if (env.LOGNAME) {
    return env.LOGNAME;
  }
  const uid = getuid?.();
  if (uid !== undefined) {
    return String(uid);
  }
  return "acpella";
}
