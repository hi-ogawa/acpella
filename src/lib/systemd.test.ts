import { describe, expect, it } from "vitest";
import { buildSystemdUnit } from "./systemd.ts";

describe(buildSystemdUnit, () => {
  it("renders network ordering and stable environment lines", () => {
    const unit = buildSystemdUnit({
      workingDirectory: "/home/alice/code/acpella",
      env: {
        PATH: "/run/user/1000/fnm_multishells/123_456/bin:/custom/bin:/usr/bin",
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
    expect(unit).not.toContain("/custom/bin");
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
