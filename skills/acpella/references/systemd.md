# systemd

Use this reference for installing acpella as a user service, updating the unit, and checking live service logs.

## Generate the user unit

From the checkout you want to run:

```bash
pnpm cli exec /service systemd install
```

This writes a user unit for the current checkout. Prefer running this from a local shell through `exec`; it is a host administration side effect.

## First install

```bash
systemctl --user daemon-reload
systemctl --user enable --now acpella
```

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
