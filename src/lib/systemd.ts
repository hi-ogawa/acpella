import { mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { uniq } from "./utils.ts";

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

// https://github.com/openclaw/openclaw/blob/83f6a26d77ce2668b5d0cfba57667e1b0793a525/src/daemon/systemd-unit.ts
export function buildSystemdUnit(options: {
  workingDirectory: string;
  env: NodeJS.ProcessEnv;
  home: string;
  nodeBin: string;
  tmpDir: string;
}): string {
  const envFile = resolve(options.workingDirectory, ".env");
  const serviceEnv = {
    HOME: options.home,
    TMPDIR: options.env.TMPDIR?.trim() || options.tmpDir,
    PATH: buildServicePath(options),
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
Restart=always
RestartSec=2
KillMode=control-group

[Install]
WantedBy=default.target
`;
}

// Build a minimal but usable PATH for systemd user services.
// Based on openclaw's service environment path construction:
// https://github.com/openclaw/openclaw/blob/83f6a26d77ce2668b5d0cfba57667e1b0793a525/src/daemon/service-env.ts
function buildServicePath(options: { nodeBin: string; home: string }): string {
  const { nodeBin, home } = options;

  const dirs = [
    dirname(nodeBin),
    resolve(home, ".local/bin"),
    resolve(home, ".cargo/bin"),
    resolve(home, ".bun/bin"),
    resolve(home, ".volta/bin"),
    resolve(home, ".asdf/shims"),
    resolve(home, ".npm-global/bin"),
    resolve(home, ".fnm/aliases/default/bin"),
    resolve(home, ".nvm/current/bin"),
    resolve(home, "bin"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    resolve(home, ".linuxbrew/bin"),
    "/home/linuxbrew/.linuxbrew/bin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/usr/sbin",
    "/usr/bin",
    "/bin",
    "/sbin",
  ];

  return uniq(dirs).join(":");
}

function escapeSystemdValue(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
