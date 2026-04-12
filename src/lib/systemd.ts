import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export function handleSetupSystemd(): void {
  const workingDirectory = process.cwd();
  const description = "acpella service";
  const envFile = resolve(workingDirectory, ".env");
  const nodeBin = process.execPath;
  const serviceName = "acpella";
  const unitFile = resolve(homedir(), ".config/systemd/user/acpella.service");

  const unit = `[Unit]
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
`;

  mkdirSync(dirname(unitFile), { recursive: true });
  writeFileSync(unitFile, unit);

  console.log(`Wrote ${unitFile}`);
  console.log("Run these commands to enable it:");
  console.log("  systemctl --user daemon-reload");
  console.log("  systemctl --user enable --now acpella");
}

function escapeSystemdValue(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
