# Deploy

## Setup

```bash
git clone https://github.com/hi-ogawa/acpella
cd acpella
pnpm install
cp .env.example .env
# edit .env using the README Config section
```

## systemd

Generate a user unit for the current checkout:

```bash
pnpm cli --setup-systemd
```

Example output:

```text
Wrote /home/hiroshi/.config/systemd/user/acpella.service

First install:
  systemctl --user daemon-reload
  systemctl --user enable --now acpella

After updating this unit:
  systemctl --user daemon-reload
  systemctl --user restart acpella

Logs:
  journalctl --user -u acpella -f
```
