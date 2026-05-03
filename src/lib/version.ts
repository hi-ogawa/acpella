import { execFileAsync } from "../utils/process.ts";

export async function getVersion(options: { cwd: string }): Promise<string> {
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
    const checkout = branch || "detached";
    const dirty = status ? " (dirty)" : "";
    return `git ${head} ${checkout}${dirty}`;
  } catch {
    return "git failed";
  }
}
