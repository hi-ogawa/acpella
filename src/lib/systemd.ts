import { mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

export function handleSetupSystemd(): void {
  const workingDirectory = process.cwd();
  const unitFile = resolve(homedir(), ".config/systemd/user/acpella.service");
  const unit = buildSystemdUnit({
    workingDirectory,
    env: process.env,
    home: homedir(),
    nodeBin: process.execPath,
    tmpDir: tmpdir(),
  });

  mkdirSync(dirname(unitFile), { recursive: true });
  writeFileSync(unitFile, unit);

  console.log(`Wrote ${unitFile}`);
  console.log("Run these commands to enable it:");
  console.log("  systemctl --user daemon-reload");
  console.log("  systemctl --user enable --now acpella");
}

export function buildSystemdUnit(options: {
  workingDirectory: string;
  env: NodeJS.ProcessEnv;
  home: string;
  nodeBin: string;
  tmpDir: string;
}): string {
  const description = "acpella service";
  const envFile = resolve(options.workingDirectory, ".env");
  const serviceName = "acpella";
  const serviceEnv = {
    HOME: options.home,
    TMPDIR: options.env.TMPDIR?.trim() || options.tmpDir,
    PATH: buildServicePath({
      nodeBin: options.nodeBin,
    }),
  };
  const environmentLines = Object.entries(serviceEnv)
    .map(([key, value]) => `Environment=${escapeSystemdValue(`${key}=${value}`)}`)
    .join("\n");

  return `[Unit]
Description=${escapeSystemdValue(description)}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
SyslogIdentifier=${escapeSystemdValue(serviceName)}
WorkingDirectory=${escapeSystemdValue(options.workingDirectory)}
EnvironmentFile=${escapeSystemdValue(envFile)}
${environmentLines}
ExecStart=${escapeSystemdValue(options.nodeBin)} ${escapeSystemdValue(resolve(options.workingDirectory, "src/cli.ts"))}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`;
}

export function buildServicePath(options: { nodeBin: string }): string {
  const dirs = [dirname(options.nodeBin), "/usr/local/bin", "/usr/bin", "/bin"];

  return [...new Set(dirs)].join(":");
}

function escapeSystemdValue(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
