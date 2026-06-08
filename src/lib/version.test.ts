import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";
import { useFs } from "../test/helper.ts";
import { getVersion } from "./version.ts";

test("returns package path without git metadata when cwd is not a git repository", async () => {
  const { root } = useFs({ prefix: "version" });
  const output = await getVersion({ cwd: root });
  expect(output).toBe(`v0.0.0 (${path.resolve(".")})`);
});

test("returns git metadata and package path when cwd is a git repository", async () => {
  const { root } = useFs({ prefix: "version" });
  fs.writeFileSync(path.join(root, "sample.txt"), "ok\n");
  execFileSync("git", ["init"], { cwd: root });
  execFileSync("git", ["config", "user.name", "test"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["add", "sample.txt"], { cwd: root });
  execFileSync("git", ["commit", "-m", "init"], { cwd: root });

  const output = await getVersion({ cwd: root });
  expect(output).toMatch(
    new RegExp(`^v0\\.0\\.0 \\(git [0-9a-f]+ [^\\s)]+\\) \\(${path.resolve(".")}\\)$`),
  );
});
