import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { formatShellResult, runShellCommand } from "./shell.ts";

test("shell command runs from cwd", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "acpella-shell-"));
  const result = await runShellCommand({ command: "pwd", cwd });

  expect(result).toMatchObject({
    exitCode: 0,
    stderr: "",
    timedOut: false,
  });
  expect(result.stdout.trim()).toBe(cwd);
});

test("shell command captures stderr and non-zero exit code", async () => {
  const result = await runShellCommand({
    command: "printf err >&2; exit 7",
    cwd: tmpdir(),
  });

  expect(result).toMatchObject({
    exitCode: 7,
    stdout: "",
    stderr: "err",
    timedOut: false,
  });
});

test("shell output formatter includes empty output", () => {
  expect(
    formatShellResult({
      command: "true",
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
    }),
  ).toBe(`\
$ true
exit: 0

(no output)`);
});
