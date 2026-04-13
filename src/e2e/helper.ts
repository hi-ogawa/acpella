import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { onTestFinished, TestRunner, vi, type TestContext } from "vitest";

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

  onTestFinished(async () => {
    child.kill();
    await done.promise.catch(() => {});
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  function waitForOutput(pattern: string) {
    const matched = Promise.withResolvers<void>();
    if (stdout.includes(pattern)) {
      matched.resolve();
    } else {
      const check = () => {
        if (stdout.includes(pattern)) {
          child.stdout.off("data", check);
          matched.resolve();
        }
      };
      child.stdout.on("data", check);
    }
    return matched.promise;
  }

  return {
    write(text: string) {
      stdout = "";
      child.stdin.write(text + "\n");
    },
    waitForOutput: vi.defineHelper(async (pattern: string) => {
      // TODO: not working with defineHelper?
      const stackTraceError = new Error("__STACK_TRACE__");
      function createError(message: string) {
        const error = new Error(
          message +
            `
pattern:
${pattern}
stdout:
${stdout}
stderr:
${stderr}
`,
        );
        return copyStackTrace(error, stackTraceError);
      }

      using _ = registerErrorOnTimeout({
        context: TestRunner.getCurrentTest()!.context,
        createError: () => createError(`Timed out waiting for output`),
      });

      const waitPromise = waitForOutput(pattern);
      const raceResult = await promiseRaceWith(waitPromise, done.promise);
      if (!raceResult.ok) {
        throw createError(`Process exited waiting for output`);
      }
    }),
  };
}

// surface specific error on timeout
function registerErrorOnTimeout({
  context,
  createError,
}: {
  context: TestContext;
  createError: () => Error;
}) {
  const addError = () => {
    const error = createError();
    context.task.result!.errors ??= [];
    context.task.result!.errors!.push({
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
  };
  context.signal.addEventListener("abort", addError);
  const deregister = () => {
    context.signal.removeEventListener("abort", addError);
  };
  return {
    deregister,
    [Symbol.dispose]() {
      deregister();
    },
  };
}

/** Type-safe `Promise.race` — tells you which promise won. */
function promiseRaceWith<A, B>(
  promise: Promise<A>,
  other?: Promise<B>,
): Promise<{ ok: true; value: A } | { ok: false; value: B }> {
  const left = promise.then((value) => ({ ok: true as const, value }));
  if (!other) {
    return left;
  }
  return Promise.race([left, other.then((value) => ({ ok: false as const, value }))]);
}

function copyStackTrace(target: Error, source: Error) {
  if (source.stack !== undefined) {
    target.stack = source.stack.replace(source.message, target.message);
  }
  return target;
}
