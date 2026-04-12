import { spawn } from "node:child_process";

// TODO: review slop

export interface SpawnResult {
  stdout: string;
  stderr: string;
}

export interface SpawnOptions {
  timeout: number;
  cwd?: string;
  env?: Record<string, string | undefined>;
  debug?: boolean;
  /** Label for debug log lines (default: "spawn") */
  label?: string;
}

export function spawnAsync(
  bin: string,
  args: string[],
  options: SpawnOptions = { timeout: 60_000 },
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const label = options.label ?? "spawn";

    if (options.debug) {
      console.debug(`[${label}] ${bin} ${args.join(" ")}`);
    }

    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (options.debug) {
        for (const line of text.split("\n").filter(Boolean)) {
          console.debug(`[${label}:err] ${line}`);
        }
      }
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${label} timed out after ${options.timeout}ms`));
    }, options.timeout);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const msg = stderr.trim().split("\n").pop() || `exit code ${code}`;
        reject(new Error(`${label} failed: ${msg}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}
