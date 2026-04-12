import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// TODO: review slop

const REPO_ROOT = path.join(import.meta.dirname, "../..");
const TMP_ROOT = path.join(import.meta.dirname, ".tmp");

export function startService(env?: Record<string, string>) {
  fs.mkdirSync(TMP_ROOT, { recursive: true });
  const home = fs.mkdtempSync(path.join(TMP_ROOT, "acpella-"));
  const child = spawn("node", ["src/cli.ts", "--repl"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ACPELLA_AGENT: "test",
      ACPELLA_HOME: home,
      ...env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const lines: string[] = [];
  let buf = "";

  child.stdout.on("data", (chunk: Buffer) => {
    buf += chunk.toString();
    const parts = buf.split("\n");
    buf = parts.pop()!;
    for (const line of parts) {
      lines.push(line);
    }
  });

  // TODO: composable assertion
  async function waitForLine(match: string | RegExp, timeoutMs = 10000): Promise<string> {
    const found = lines.find((l) =>
      typeof match === "string" ? l.includes(match) : match.test(l),
    );
    if (found) {
      return found;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for "${match}". Lines so far:\n${lines.join("\n")}`));
      }, timeoutMs);

      const check = () => {
        const idx = lines.findIndex((l) =>
          typeof match === "string" ? l.includes(match) : match.test(l),
        );
        if (idx >= 0) {
          clearTimeout(timer);
          child.stdout.off("data", check);
          resolve(lines[idx]);
        }
      };
      child.stdout.on("data", check);
    });
  }

  function send(text: string) {
    child.stdin.write(text + "\n");
  }

  async function stop() {
    child.stdin.end();
    await new Promise<void>((resolve) => child.on("close", resolve));
    fs.rmSync(home, { recursive: true, force: true });
  }

  return { child, lines, send, waitForLine, stop, home };
}
