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

```ini
# /etc/systemd/system/acpella.service
[Unit]
Description=acpella service
After=network.target

[Service]
Type=simple
User=hiroshi
WorkingDirectory=/home/hiroshi/code/personal/acpella
EnvironmentFile=/home/hiroshi/code/personal/acpella/.env
ExecStart=/usr/bin/node src/cli.ts
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now acpella
sudo systemctl status acpella
journalctl -u acpella -f
```

## Manual run

```bash
pnpm start
```
