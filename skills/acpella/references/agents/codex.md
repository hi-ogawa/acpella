# Codex ACP

Use this reference when registering or changing the Codex ACP backend for acpella.

## Registration

`npx -y @zed-industries/codex-acp` is the portable registration path:

```bash
acpella exec /agent new codex npx -y @zed-industries/codex-acp
```

If `@zed-industries/codex-acp` is installed globally and `codex-acp` is available on the same `PATH` used by acpella, registering `codex-acp` directly is also fine:

```bash
acpella exec /agent new codex codex-acp
```

Make Codex the default for future sessions:

```bash
acpella exec /agent default codex
```

## Configuration Overrides

Codex ACP reads Codex CLI configuration through its own `-c key=value` override flag.

For example, to run Codex without sandboxing:

```bash
acpella exec /agent new codex npx -y @zed-industries/codex-acp -c sandbox_mode=danger-full-access
```

Check `codex-acp --help` for the current configuration override syntax before changing flags.
