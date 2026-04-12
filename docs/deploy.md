# Deploy

Run acpella alongside existing openclaw on the same machine.

## Setup

```bash
git clone https://github.com/hi-ogawa/acpella ~/code/personal/acpella
cd ~/code/personal/acpella
pnpm install
cp .env.example .env
# fill in ACPELLA_TELEGRAM_BOT_TOKEN and ACPELLA_TELEGRAM_ALLOWED_USER_IDS
```

## systemd

Generate a user unit for the current checkout:

```bash
pnpm cli --setup-systemd
mkdir -p ~/.config/systemd/user
pnpm cli --setup-systemd > ~/.config/systemd/user/acpella.service
```

Example output:

```ini
# ~/.config/systemd/user/acpella.service
[Unit]
Description=acpella service

[Service]
Type=simple
SyslogIdentifier=acpella
WorkingDirectory=/home/hiroshi/code/personal/acpella
EnvironmentFile=/home/hiroshi/code/personal/acpella/.env
ExecStart=/home/hiroshi/.local/share/mise/installs/node/24.12.0/bin/node /home/hiroshi/code/personal/acpella/src/cli.ts
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now acpella
systemctl --user status acpella
journalctl --user -u acpella -f
```

For the user service to start at boot before you log in, enable lingering once:

```bash
loginctl enable-linger "$USER"
```

## Manual run

```bash
pnpm cli
```
