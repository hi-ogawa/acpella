import { spawn } from "node:child_process";

const DEFAULT_SHELL_TIMEOUT_MS = 10_000;

export async function handleShellCommand({
  command,
  cwd,
  timeoutMs = DEFAULT_SHELL_TIMEOUT_MS,
}: {
  command: string;
  cwd: string;
  timeoutMs?: number;
}): Promise<string> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const child = spawn(command, {
    cwd,
    detached: true,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let timedOut = false;
  let error: Error | undefined;

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

  child.on("error", (errorEvent) => {
    error = errorEvent;
    resolve();
  });

  child.on("close", () => {
    resolve();
  });

  await promise;
  clearTimeout(timeout);

  const lines = [`$ ${command}`];
  if (timedOut) {
    lines.push(`timed out after ${timeoutMs / 1000}s`);
  } else {
    lines.push(`exit: ${child.exitCode ?? "(unknown)"}`);
  }
  if (child.signalCode) {
    lines.push(`signal: ${child.signalCode}`);
  }
  if (error) {
    lines.push("", "error:", error.message);
  }
  const trimmedStdout = Buffer.concat(stdout).toString().trimEnd();
  const trimmedStderr = Buffer.concat(stderr).toString().trimEnd();
  lines.push("", "stdout:", trimmedStdout || "(empty)");
  lines.push("", "stderr:", trimmedStderr || "(empty)");
  return lines.join("\n");
}

export function parseShellCommandArgs(args: string[]): { command: string; timeoutMs: number } {
  const [first] = args;
  let timeoutMs = DEFAULT_SHELL_TIMEOUT_MS;

  if (first?.startsWith("--timeout=")) {
    const value = first.slice("--timeout=".length);
    const timeoutSeconds = Number(value);
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
      throw new Error(`Invalid timeout: ${first}`);
    }
    args = args.slice(1);
    timeoutMs = timeoutSeconds * 1000;
  }

  const command = args.join(" ").trim();
  if (!command) {
    throw new Error("Missing command");
  }

  return { command, timeoutMs };
}
