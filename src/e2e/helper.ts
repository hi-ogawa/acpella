import { spawn } from "node:child_process";

// TODO: review slop

export function startDaemon(env?: Record<string, string>) {
  const child = spawn("node", ["src/index.ts"], {
    cwd: import.meta.dirname + "/../..",
    env: {
      ...process.env,
      ACPELLA_TEST_BOT: "1",
      ACPELLA_AGENT: "codex",
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
  async function waitForLine(match: string | RegExp, timeoutMs = 5000): Promise<string> {
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
  }

  return { child, lines, send, waitForLine, stop };
}
