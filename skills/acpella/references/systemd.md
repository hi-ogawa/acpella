# systemd

Use this reference for installing acpella as a user service, updating the unit, and checking live service logs.

## Generate the user unit

Use the global `acpella` CLI linked to the checkout/version you want the service to run:

```bash
acpella exec /service systemd install
```

This writes a user unit for the linked acpella installation. Prefer running this from a local shell through `exec`; it is a host administration side effect.

## First install

```bash
systemctl --user daemon-reload
systemctl --user enable --now acpella
```

## Boot and suspend gotchas

`acpella` is installed as a systemd user service. If it should start after boot
without an interactive login, enable lingering for that user:

```bash
sudo loginctl enable-linger $USER
loginctl show-user $USER -p Linger
```

Lingering starts the user's `systemd --user` manager at boot, so enabled user
services can run before GDM, GNOME, or another graphical login session exists.
That is useful for headless recovery after reboot, but it can also start user
services earlier than expected. Keep the unit headless and avoid assumptions
about `DISPLAY`, Wayland, desktop session targets, or an unlocked keyring.

Lingering does not prevent suspend. For an always-on laptop or closed-lid bot,
also configure the machine not to sleep; otherwise all services stop while the
machine is suspended.

## After updating the unit

```bash
systemctl --user daemon-reload
systemctl --user restart acpella
```

## Live logs

```bash
journalctl --user -u acpella -f
```

## Next steps

- For general runtime debugging beyond systemd, continue with [troubleshooting.md](troubleshooting.md).
- For first-time clone/install/env setup, continue with [bootstrap.md](bootstrap.md).
