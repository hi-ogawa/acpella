import { spawn } from "node:child_process";
import path from "node:path";
import { onTestFinished, TestRunner, vi, type TestContext } from "vitest";
import { useFs } from "../test/helper.ts";

export type TestService = ReturnType<typeof startService>;

export function startService(options?: { env?: Record<string, string>; sourceDir?: string }) {
  const { root } = useFs({
    prefix: "e2e",
    sourceDir: options?.sourceDir,
  });

  const child = spawn("pnpm", ["-s", "repl"], {
    cwd: path.join(import.meta.dirname, "../.."),
    env: {
      ...process.env,
      ACPELLA_HOME: root,
      ...options?.env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const done = Promise.withResolvers<Error | undefined>();
  child.on("error", (err) => {
    done.resolve(err);
  });
  child.on("exit", (code) => {
    if (code === 0) {
      done.resolve(undefined);
    } else {
      done.resolve(new Error(`Service exited with code ${code ?? "<none>"}`));
    }
  });

  onTestFinished(async () => {
    child.kill();
    await done.promise;
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  async function waitForOutput(pattern: string) {
    // TODO: defineHelper as object method not working
    // https://github.com/vitest-dev/vitest/issues/10135
    const stackTraceError = new Error("__STACK_TRACE__");
    function createError(message: string) {
      const error = new Error(`\
${message}
pattern:
${pattern}
stdout:
${stdout}
stderr:
${stderr}
`);
      return copyStackTrace(error, stackTraceError);
    }

    using _ = recordErrorOnTimeout({
      context: TestRunner.getCurrentTest()!.context,
      createError: () => createError(`Timed out waiting for output`),
    });

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

    const raceResult = await promiseRaceWith(matched.promise, done.promise);
    if (!raceResult.ok) {
      if (raceResult.value) {
        throw copyStackTrace(raceResult.value, stackTraceError);
      }
      throw createError(`Process exited waiting for output`);
    }
  }

  return {
    write(text: string) {
      stdout = "";
      child.stdin.write(text + "\n");
    },
    waitForOutput: vi.defineHelper(waitForOutput),
  };
}

// surface custom async assertion error on timeout
function recordErrorOnTimeout({
  context,
  createError,
}: {
  context: TestContext;
  createError: () => Error;
}) {
  const addError = () => {
    const timeoutError = context.signal.reason as Error;
    const error = createError();
    timeoutError.message += "\n[Caused by] " + error.message;
    copyStackTrace(timeoutError, error);
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
