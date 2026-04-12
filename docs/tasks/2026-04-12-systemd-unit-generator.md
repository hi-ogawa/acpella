# systemd unit generator

## Problem context and approach

Deploying acpella through systemd currently requires copying a static unit from `docs/deploy.md` and editing user-specific paths by hand. Add a CLI helper that generates a unit from the current checkout so the deploy path, Node binary, environment file, and service user match the local installation.

The CLI should print a user unit to stdout by default. This keeps installation explicit, easy to inspect, and usable without writing to `/etc/systemd/system`:

```bash
pnpm generate-systemd-unit
pnpm generate-systemd-unit > ~/.config/systemd/user/acpella.service
```

System units are still useful for machine-level service management, so keep a `--system` option.

## Reference files/patterns to follow

- `package.json` uses `node` directly for `.ts` entrypoints.
- `pnpm start` runs `node --env-file=.env src/index.ts`.
- `src/lib/systemd.ts` owns unit option parsing and rendering.
- `docs/deploy.md` contains the existing static systemd unit.
- Project conventions prefer kebab-case file names, `.ts` extensions, and options objects for functions.

## Implementation plan

- Add `generate-systemd-unit` CLI mode to `src/index.ts`.
- Keep the systemd option parsing/rendering in `src/lib/systemd.ts`.
- Add a `generate-systemd-unit` package script that calls the entrypoint CLI.
- Update deploy docs to show user-unit generation and the system-unit fallback.
- Run lint/check if available.
