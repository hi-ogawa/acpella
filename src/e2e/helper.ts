import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { onTestFinished, TestRunner } from "vitest";

// TODO: review slop

export function startService(
  env?: Record<string, string>,
  options?: {
    sourceDir?: string;
  },
) {
  const home = path.join(import.meta.dirname, `.tmp/acpella-test-${crypto.randomUUID()}`);
  fs.mkdirSync(home, { recursive: true });
  if (options?.sourceDir) {
    fs.rmSync(home, { recursive: true, force: true });
    fs.cpSync(options.sourceDir, home, { recursive: true });
  }
  onTestFinished(async () => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  const child = spawn("pnpm", ["-s", "cli", "--repl"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env,
      ACPELLA_AGENT: "test",
      ACPELLA_HOME: home,
      ...env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const done = Promise.withResolvers<void>();
  child.on("error", (err) => {
    done.reject(err);
  });
  child.on("exit", (code) => {
    if (code === 0) {
      done.resolve();
    } else {
      done.reject(new Error(`Service exited with code ${code ?? "<none>"}`));
    }
  });

  const test = TestRunner.getCurrentTest()!;
  test.context.signal.addEventListener("abort", () => {
    child.kill();
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  // TODO: composable assertion
  // TODO: race with donePromise
  // TODO: surface error on timeout

  async function waitForLine(pattern: string): Promise<void> {
    const promise = Promise.withResolvers<void>();
    if (stdout.includes(pattern)) {
      promise.resolve();
    } else {
      const check = () => {
        if (stdout.includes(pattern)) {
          child.stdout.off("data", check);
          promise.resolve();
        }
      };
      child.stdout.on("data", check);
    }
    return promise.promise;
  }

  function write(text: string) {
    child.stdin.write(text + "\n");
  }

  async function stop() {
    child.stdin.end();
    await done.promise;
  }

  return { child, write, waitForLine, stop, home };
}
