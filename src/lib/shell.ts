import { exec, type ExecException } from "node:child_process";

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

export async function runShellCommand({
  command,
  cwd,
  timeoutMs = DEFAULT_SHELL_TIMEOUT_MS,
}: {
  command: string;
  cwd: string;
  timeoutMs?: number;
}): Promise<ShellResult> {
  return await new Promise((resolve) => {
    exec(
      command,
      {
        cwd,
        timeout: timeoutMs,
      },
      (error, stdout, stderr) => {
        const execError = (error ?? undefined) as ExecException | undefined;
        const code = typeof execError?.code === "number" ? execError.code : undefined;
        const signal = execError?.signal ?? undefined;
        resolve({
          command,
          stdout,
          stderr,
          timeoutMs,
          exitCode: code ?? (execError ? undefined : 0),
          signal,
          timedOut: Boolean(execError?.killed && signal === "SIGTERM"),
        });
      },
    );
  });
}

export function formatShellResult(result: ShellResult): string {
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
