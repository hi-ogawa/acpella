# Codex ACP

Use this reference when registering or changing the Codex ACP backend for acpella.

## Registration

`npx -y @agentclientprotocol/codex-acp` is the portable registration path:

```bash
acpella exec /agent new codex npx -y @agentclientprotocol/codex-acp
```

If `@agentclientprotocol/codex-acp` is installed globally and `codex-acp` is available on the same `PATH` used by acpella, registering `codex-acp` directly is also fine:

```bash
acpella exec /agent new codex codex-acp
```

Make Codex the default for future sessions:

```bash
acpella exec /agent default codex
```

## Runtime Options

Codex ACP reads runtime options from environment variables. `CODEX_CONFIG` accepts a JSON object that is merged into the Codex session configuration, while `INITIAL_AGENT_MODE` selects the initial permission mode.

For example, to select a model and start in full-access agent mode:

```bash
acpella exec /agent new codex env INITIAL_AGENT_MODE=agent-full-access 'CODEX_CONFIG={"model":"gpt-5.6-sol"}' codex-acp
```

See the [Codex ACP runtime options](https://github.com/agentclientprotocol/codex-acp#runtime-options) for the current environment variables and accepted values.
