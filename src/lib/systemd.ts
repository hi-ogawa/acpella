import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

export function handleSetupSystemd(): void {
  const workingDirectory = process.cwd();
  const description = "acpella service";
  const envFile = resolve(workingDirectory, ".env");
  const nodeBin = process.execPath;
  const serviceName = "acpella";
  const home = homedir();
  const unitFile = resolve(home, ".config/systemd/user/acpella.service");
  const stablePath = buildStablePath(process.execPath, process.env.PATH ?? "");

  const unit = `[Unit]
Description=${escapeSystemdValue(description)}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
SyslogIdentifier=${escapeSystemdValue(serviceName)}
WorkingDirectory=${escapeSystemdValue(workingDirectory)}
EnvironmentFile=${escapeSystemdValue(envFile)}
Environment=HOME=${escapeSystemdValue(home)}
Environment=TMPDIR=/tmp
Environment=PATH=${escapeSystemdValue(stablePath)}
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

const VOLATILE_PATH_PATTERN = /\/run\/user\/[^/]+\/fnm_multishells\//;
const FALLBACK_PATHS = ["/usr/local/bin", "/usr/bin", "/bin"];

export function buildStablePath(execPath: string, envPath: string): string {
  const nodeDir = dirname(execPath);

  const filtered = envPath.split(":").filter((p) => p !== "" && !VOLATILE_PATH_PATTERN.test(p));

  const seen = new Set<string>();
  const parts: string[] = [];

  for (const p of [nodeDir, ...filtered, ...FALLBACK_PATHS]) {
    if (!seen.has(p)) {
      seen.add(p);
      parts.push(p);
    }
  }

  return parts.join(":");
}

function escapeSystemdValue(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
