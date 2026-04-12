# systemd unit generator

## Problem context and approach

Deploying acpella through systemd currently requires copying a static unit from `docs/deploy.md` and editing user-specific paths by hand. Add a CLI helper that generates a unit from the current checkout so the deploy path, Node binary, environment file, and service user match the local installation.

The CLI should print a user unit to stdout by default. This keeps installation explicit, easy to inspect, and usable without writing to `/etc/systemd/system`:

```bash
pnpm cli --setup-systemd
pnpm cli --setup-systemd > ~/.config/systemd/user/acpella.service
```

## Reference files/patterns to follow

- `package.json` uses `node` directly for `.ts` entrypoints.
- `pnpm cli` runs `node --env-file-if-exists=.env src/cli.ts`.
- `src/lib/systemd.ts` owns unit option parsing and rendering.
- `docs/deploy.md` contains the existing static systemd unit.
- Project conventions prefer kebab-case file names, `.ts` extensions, and options objects for functions.

## Implementation plan

- Add `--setup-systemd` CLI mode to `src/cli.ts`.
- Keep the systemd option parsing/rendering in `src/lib/systemd.ts`.
- Update deploy docs to show user-unit generation.
- Run lint/check if available.
