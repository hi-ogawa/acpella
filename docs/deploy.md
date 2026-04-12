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
pnpm cli --setup-systemd
```

Example output:

```text
Wrote /home/hiroshi/.config/systemd/user/acpella.service
Run these commands to enable it:
  systemctl --user daemon-reload
  systemctl --user enable --now acpella
```
