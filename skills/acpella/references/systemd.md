# systemd

Use this reference for installing acpella as a user service, updating the unit, and checking live service logs.

Primary sources:

- `README.md`
- `docs/deploy.md`

## Generate the user unit

From the checkout you want to run:

```bash
pnpm cli --setup-systemd
```

This writes a user unit for the current checkout.

Primary source:

- `docs/deploy.md`

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

- For general runtime debugging beyond systemd, continue with `troubleshooting.md`.
- For first-time clone/install/env setup, continue with `bootstrap.md`.
