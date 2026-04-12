import { resolve } from "node:path";

export function handleSetupSystemd(): void {
  const workingDirectory = process.cwd();
  const description = "acpella service";
  const envFile = resolve(workingDirectory, ".env");
  const nodeBin = process.execPath;
  const serviceName = "acpella";

  process.stdout.write(`[Unit]
Description=${escapeSystemdValue(description)}

[Service]
Type=simple
SyslogIdentifier=${escapeSystemdValue(serviceName)}
WorkingDirectory=${escapeSystemdValue(workingDirectory)}
EnvironmentFile=${escapeSystemdValue(envFile)}
ExecStart=${escapeSystemdValue(nodeBin)} ${escapeSystemdValue(resolve(workingDirectory, "src/cli.ts"))}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`);
}

function escapeSystemdValue(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
