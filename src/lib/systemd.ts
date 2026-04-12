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
${envLine}ExecStart=${escapeSystemdValue(options.nodeBin)} ${escapeSystemdValue(resolve(options.workingDirectory, "src/cli.ts"))}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=${installTarget}
`;
}

export function renderSystemdUnitHelp(defaults: SystemdUnitOptions): string {
  return `Usage: node src/cli.ts --setup-systemd [options]

Print a systemd unit for this acpella checkout.

Options:
  working directory: ${defaults.workingDirectory}
  env file: ${defaults.envFile}
  node: ${defaults.nodeBin}
  -h, --help                  Show this help.
`;
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
