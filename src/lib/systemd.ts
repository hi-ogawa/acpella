import { accessSync, constants, mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { uniq } from "./utils.ts";

export function handleSystemdInstall(options: {
  workingDirectory: string;
  envFile?: string;
}): string {
  const unitContent = buildSystemdUnit({
    workingDirectory: options.workingDirectory,
    env: process.env,
    envFile: options.envFile,
    acpellaBin: findExecutable({ command: "acpella", path: process.env.PATH }),
    home: homedir(),
    entrypoint: process.argv[1],
    nodeBin: process.execPath,
    tmpDir: tmpdir(),
  });

  const unitFile = resolve(homedir(), ".config/systemd/user/acpella.service");
  mkdirSync(dirname(unitFile), { recursive: true });
  writeFileSync(unitFile, unitContent);

  return `\
Wrote ${unitFile}

First install:
  systemctl --user daemon-reload
  systemctl --user enable --now acpella

After updating this unit:
  systemctl --user daemon-reload
  systemctl --user restart acpella

Logs:
  journalctl --user -u acpella -f
`;
}

// https://github.com/openclaw/openclaw/blob/83f6a26d77ce2668b5d0cfba57667e1b0793a525/src/daemon/systemd-unit.ts
export function buildSystemdUnit(options: {
  workingDirectory: string;
  env: NodeJS.ProcessEnv;
  envFile?: string;
  acpellaBin?: string;
  entrypoint?: string;
  home: string;
  nodeBin: string;
  tmpDir: string;
}): string {
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
${environmentLines}
ExecStart=${buildExecStart(options)}
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

function buildExecStart(options: {
  entrypoint?: string;
  envFile?: string;
  acpellaBin?: string;
  nodeBin: string;
}): string {
  const serveArgs = [...(options.envFile ? ["--env-file", options.envFile] : []), "serve"];
  const entrypoint = options.entrypoint ? resolve(options.entrypoint) : "acpella";
  const command = options.acpellaBin
    ? [options.acpellaBin, ...serveArgs]
    : isSourceCliEntrypoint(entrypoint)
      ? [options.nodeBin, entrypoint, ...serveArgs]
      : [entrypoint, ...serveArgs];

  return command.map(escapeSystemdValue).join(" ");
}

function isSourceCliEntrypoint(entrypoint: string): boolean {
  return basename(entrypoint) === "cli.ts" && entrypoint.endsWith("/src/cli.ts");
}

function findExecutable(options: { command: string; path?: string }): string | undefined {
  const path = options.path?.trim();
  if (!path) {
    return;
  }
  for (const dir of path.split(":")) {
    if (!dir) {
      continue;
    }
    const candidate = resolve(dir, options.command);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
}

function escapeSystemdValue(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
