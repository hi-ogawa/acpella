import { spawn } from "node:child_process";

const DEFAULT_SHELL_TIMEOUT_MS = 10_000;

type ShellResult = {
  command: string;
  stdout: string;
  stderr: string;
  timeoutMs: number;
  exitCode?: number;
  signal?: string;
  timedOut: boolean;
};

export async function handleShellCommand({
  command,
  cwd,
  timeoutMs,
}: {
  command: string;
  cwd: string;
  timeoutMs?: number;
}): Promise<string> {
  const result = await runShellCommand({
    command,
    cwd,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return formatShellResult(result);
}

async function runShellCommand({
  command,
  cwd,
  timeoutMs = DEFAULT_SHELL_TIMEOUT_MS,
}: {
  command: string;
  cwd: string;
  timeoutMs?: number;
}): Promise<ShellResult> {
  return await new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      detached: true,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          child.kill("SIGTERM");
        }
      }
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        command,
        stdout: Buffer.concat(stdout).toString(),
        stderr: `${Buffer.concat(stderr).toString()}${error.message}`,
        timeoutMs,
        timedOut,
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({
        command,
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
        timeoutMs,
        exitCode: code ?? undefined,
        signal: signal ?? undefined,
        timedOut,
      });
    });
  });
}

function formatShellResult(result: ShellResult): string {
  const lines = [`$ ${result.command}`];
  if (result.timedOut) {
    lines.push(`timed out after ${result.timeoutMs / 1000}s`);
  } else {
    lines.push(`exit: ${result.exitCode ?? "(unknown)"}`);
  }
  if (result.signal) {
    lines.push(`signal: ${result.signal}`);
  }

  const stdout = result.stdout.trimEnd();
  const stderr = result.stderr.trimEnd();
  if (stdout) {
    lines.push("", "stdout:", stdout);
  }
  if (stderr) {
    lines.push("", "stderr:", stderr);
  }
  if (!stdout && !stderr) {
    lines.push("", "(no output)");
  }
  return lines.join("\n");
}

export function parseShellCommandArgs(
  args: string[],
): { ok: true; command: string; timeoutMs?: number } | { ok: false; error: string } {
  const [first, ...rest] = args;
  if (!first?.startsWith("--timeout=")) {
    return { ok: true, command: args.join(" ").trim() };
  }

  const value = first.slice("--timeout=".length);
  const timeoutSeconds = Number(value);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    return { ok: false, error: `Invalid timeout: ${first}` };
  }

  return {
    ok: true,
    command: rest.join(" ").trim(),
    timeoutMs: timeoutSeconds * 1000,
  };
}
