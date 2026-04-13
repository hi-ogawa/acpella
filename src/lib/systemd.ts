import { mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

export function handleSetupSystemd(): void {
  const unitContent = buildSystemdUnit({
    workingDirectory: process.cwd(),
    env: process.env,
    home: homedir(),
    nodeBin: process.execPath,
    tmpDir: tmpdir(),
  });

  const unitFile = resolve(homedir(), ".config/systemd/user/acpella.service");
  mkdirSync(dirname(unitFile), { recursive: true });
  writeFileSync(unitFile, unitContent);

  console.log(`\
Wrote ${unitFile}

First install:
  systemctl --user daemon-reload
  systemctl --user enable --now acpella

After updating this unit:
  systemctl --user daemon-reload
  systemctl --user restart acpella

Logs:
  journalctl --user -u acpella -f
`);
}

export function buildSystemdUnit(options: {
  workingDirectory: string;
  env: NodeJS.ProcessEnv;
  home: string;
  nodeBin: string;
  tmpDir: string;
}): string {
  const envFile = resolve(options.workingDirectory, ".env");
  const pathDirs = [dirname(options.nodeBin), "/usr/local/bin", "/usr/bin", "/bin"];
  const serviceEnv = {
    HOME: options.home,
    TMPDIR: options.env.TMPDIR?.trim() || options.tmpDir,
    PATH: [...new Set(pathDirs)].join(":"),
  };
  const environmentLines = Object.entries(serviceEnv)
    .map(([key, value]) => `Environment=${escapeSystemdValue(`${key}=${value}`)}`)
    .join("\n");

  return `\
[Unit]
Description=${escapeSystemdValue("acpella service")}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
SyslogIdentifier=${escapeSystemdValue("acpella")}
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

function escapeSystemdValue(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
