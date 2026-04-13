import { describe, expect, it } from "vitest";
import { buildServicePath, buildSystemdUnit } from "./systemd.ts";

describe(buildServicePath, () => {
  it("puts the current Node bin directory first", () => {
    const pathValue = buildServicePath({
      nodeBin: "/home/alice/.local/share/fnm/node-versions/v24.13.0/installation/bin/node",
    });

    expect(pathValue.split(":")[0]).toBe(
      "/home/alice/.local/share/fnm/node-versions/v24.13.0/installation/bin",
    );
  });

  it("does not copy the inherited PATH", () => {
    const pathValue = buildServicePath({
      nodeBin: "/home/alice/.local/share/fnm/node-versions/v24.13.0/installation/bin/node",
    });

    expect(pathValue).not.toContain("fnm_multishells");
    expect(pathValue.split(":")).not.toContain("/custom/bin");
  });

  it("includes system fallback paths", () => {
    const parts = buildServicePath({
      nodeBin: "/opt/node/bin/node",
    }).split(":");

    expect(parts).toEqual(["/opt/node/bin", "/usr/local/bin", "/usr/bin", "/bin"]);
  });
});

describe(buildSystemdUnit, () => {
  it("renders network ordering and stable environment lines", () => {
    const unit = buildSystemdUnit({
      workingDirectory: "/home/alice/code/acpella",
      env: {
        PATH: "/run/user/1000/fnm_multishells/123_456/bin:/usr/bin",
        TMPDIR: "/var/tmp/acpella",
      },
      home: "/home/alice",
      nodeBin: "/home/alice/.local/share/fnm/node-versions/v24.13.0/installation/bin/node",
      tmpDir: "/tmp",
    });

    expect(unit).toContain("After=network-online.target\n");
    expect(unit).toContain("Wants=network-online.target\n");
    expect(unit).toContain("Environment=HOME=/home/alice\n");
    expect(unit).toContain("Environment=TMPDIR=/var/tmp/acpella\n");
    expect(unit).toContain(
      "Environment=PATH=/home/alice/.local/share/fnm/node-versions/v24.13.0/installation/bin:/usr/local/bin:/usr/bin:/bin",
    );
    expect(unit).not.toContain("fnm_multishells");
  });

  it("quotes environment lines that contain spaces", () => {
    const unit = buildSystemdUnit({
      workingDirectory: "/home/alice/code/acpella",
      env: {},
      home: "/home/alice with space",
      nodeBin: "/opt/node/bin/node",
      tmpDir: "/tmp",
    });

    expect(unit).toContain('Environment="HOME=/home/alice with space"\n');
    expect(unit).toContain("Environment=PATH=/opt/node/bin:/usr/local/bin:/usr/bin:/bin\n");
  });
});
