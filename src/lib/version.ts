import packageJson from "../../package.json" with { type: "json" };
import { execFileAsync } from "../utils/process.ts";

export async function getVersion(options: { cwd: string }): Promise<string> {
  const gitMetadata = await getGitMetadata({ cwd: options.cwd });
  const packageVersion = `v${packageJson.version}`;
  return [packageVersion, gitMetadata ? `(${gitMetadata})` : undefined].filter(Boolean).join(" ");
}

async function getGitMetadata(options: { cwd: string }): Promise<string | undefined> {
  async function git(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", args, {
      cwd: options.cwd,
      timeout: 1000,
    });
    return stdout.trim();
  }

  try {
    const [branch, head, status] = await Promise.all([
      git(["branch", "--show-current"]),
      git(["rev-parse", "--short", "HEAD"]),
      git(["status", "--porcelain=v1"]),
    ]);
    return ["git", head, branch || "detached", status && "dirty"].filter(Boolean).join(" ");
  } catch {
    return undefined;
  }
}
