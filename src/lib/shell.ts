import { exec, type ExecException } from "node:child_process";

const DEFAULT_SHELL_TIMEOUT_MS = 10_000;
const SHELL_OUTPUT_LIMIT = 12_000;

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
        maxBuffer: SHELL_OUTPUT_LIMIT * 4,
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

  const stdout = truncateOutput(result.stdout);
  const stderr = truncateOutput(result.stderr);
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

function truncateOutput(output: string): string {
  if (output.length <= SHELL_OUTPUT_LIMIT) {
    return output.trimEnd();
  }
  const truncated = output.slice(0, SHELL_OUTPUT_LIMIT).trimEnd();
  return `${truncated}\n... truncated after ${SHELL_OUTPUT_LIMIT} characters`;
}
