import { describe, it, expect } from "vitest";
import { buildStablePath } from "./systemd.ts";

describe(buildStablePath, () => {
  it("puts node dir first", () => {
    const result = buildStablePath("/opt/node/bin/node", "/usr/bin:/bin");
    expect(result.startsWith("/opt/node/bin:")).toBe(true);
  });

  it("filters volatile fnm_multishells entries", () => {
    const envPath = [
      "/run/user/1000/fnm_multishells/12345/bin",
      "/home/user/.local/bin",
      "/usr/bin",
    ].join(":");
    const result = buildStablePath("/opt/node/bin/node", envPath);
    expect(result).not.toContain("fnm_multishells");
    expect(result).toContain("/home/user/.local/bin");
    expect(result).toContain("/usr/bin");
  });

  it("includes fallback paths", () => {
    const result = buildStablePath("/opt/node/bin/node", "");
    expect(result).toContain("/usr/local/bin");
    expect(result).toContain("/usr/bin");
    expect(result).toContain("/bin");
  });

  it("deduplicates entries", () => {
    const envPath = "/opt/node/bin:/usr/bin:/usr/bin";
    const result = buildStablePath("/opt/node/bin/node", envPath);
    const parts = result.split(":");
    const unique = new Set(parts);
    expect(parts.length).toBe(unique.size);
  });

  it("matches snapshot for typical setup", () => {
    const envPath = [
      "/run/user/1000/fnm_multishells/99999/bin",
      "/home/hiroshi/.local/share/fnm/node-versions/v24.13.0/installation/bin",
      "/home/hiroshi/.local/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ].join(":");
    const result = buildStablePath(
      "/home/hiroshi/.local/share/fnm/node-versions/v24.13.0/installation/bin/node",
      envPath,
    );
    expect(result).toMatchInlineSnapshot(
      `"/home/hiroshi/.local/share/fnm/node-versions/v24.13.0/installation/bin:/home/hiroshi/.local/bin:/usr/local/bin:/usr/bin:/bin"`,
    );
  });
});
