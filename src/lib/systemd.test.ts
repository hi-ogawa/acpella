import { describe, expect, it } from "vitest";
import { buildSystemdUnit } from "./systemd.ts";

describe(buildSystemdUnit, () => {
  it("basic", () => {
    const unit = buildSystemdUnit({
      workingDirectory: "/home/alice/code/acpella",
      env: {
        PATH: "/run/user/1000/fnm_multishells/123_456/bin:/custom/bin:/usr/bin",
        TMPDIR: "/var/tmp/acpella",
      },
      home: "/home/alice with space",
      nodeBin: "/home/alice/.local/share/fnm/node-versions/v24.13.0/installation/bin/node",
      tmpDir: "/tmp",
    });
    expect(unit).toMatchInlineSnapshot(`
      "[Unit]
      Description="acpella service"
      After=network-online.target
      Wants=network-online.target

      [Service]
      Type=simple
      SyslogIdentifier=acpella
      WorkingDirectory=/home/alice/code/acpella
      EnvironmentFile=/home/alice/code/acpella/.env
      Environment="HOME=/home/alice with space"
      Environment=TMPDIR=/var/tmp/acpella
      Environment=PATH=/home/alice/.local/share/fnm/node-versions/v24.13.0/installation/bin:/usr/local/bin:/usr/bin:/bin
      ExecStart=/home/alice/.local/share/fnm/node-versions/v24.13.0/installation/bin/node /home/alice/code/acpella/src/cli.ts
      Restart=always
      RestartSec=10

      [Install]
      WantedBy=default.target
      "
    `);
  });
});
