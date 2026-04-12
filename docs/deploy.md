# Deploy

Run acpella alongside existing openclaw on the same machine.

## Setup

```bash
git clone https://github.com/hi-ogawa/acpella
cd acpella
pnpm install
cp .env.example .env
# fill in ACPELLA_TELEGRAM_BOT_TOKEN and ACPELLA_TELEGRAM_ALLOWED_USER_IDS
```

## systemd

Generate a user unit for the current checkout:

```bash
pnpm generate-systemd-unit
mkdir -p ~/.config/systemd/user
pnpm generate-systemd-unit > ~/.config/systemd/user/acpella.service
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
ExecStart=/home/hiroshi/.local/share/mise/installs/node/24.12.0/bin/node /home/hiroshi/code/personal/acpella/src/index.ts
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

Options for a different install path:

```bash
pnpm generate-systemd-unit -- --working-directory /opt/acpella --env-file /etc/acpella.env
```

Generate a system unit instead when you want it managed by the system instance:

```bash
pnpm generate-systemd-unit -- --system | sudo tee /etc/systemd/system/acpella.service
sudo systemctl daemon-reload
sudo systemctl enable --now acpella
```

## Manual run

```bash
pnpm start
```
