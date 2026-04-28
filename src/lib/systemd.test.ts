import { describe, expect, it } from "vitest";
import { buildSystemdUnit } from "./systemd.ts";

describe(buildSystemdUnit, () => {
  it("basic", () => {
    const unit = buildSystemdUnit({
      cliEntryPath: "/home/alice/code/acpella/src/cli.ts",
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
      Environment="HOME=/home/alice with space"
      Environment=TMPDIR=/var/tmp/acpella
      Environment="PATH=/home/alice/.local/share/fnm/node-versions/v24.13.0/installation/bin:/home/alice with space/.local/bin:/home/alice with space/.cargo/bin:/home/alice with space/.bun/bin:/home/alice with space/.volta/bin:/home/alice with space/.asdf/shims:/home/alice with space/.npm-global/bin:/home/alice with space/.local/share/pnpm:/home/alice with space/.fnm/aliases/default/bin:/home/alice with space/.nvm/current/bin:/home/alice with space/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/home/alice with space/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/bin:/sbin"
      ExecStart=/home/alice/.local/share/fnm/node-versions/v24.13.0/installation/bin/node /home/alice/code/acpella/src/cli.ts serve
      Restart=always
      RestartSec=2
      KillMode=control-group

      [Install]
      WantedBy=default.target
      "
    `);
  });
});
