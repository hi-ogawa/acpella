# Claude Agent ACP

Use this reference when registering or changing the Claude Agent ACP backend for acpella.

## Registration

`@agentclientprotocol/claude-agent-acp` is the Zed/ACP adapter for Claude Code and the Claude Agent SDK.

The portable registration path is:

```bash
acpella exec /agent new claude npx -y @agentclientprotocol/claude-agent-acp
```

If `@agentclientprotocol/claude-agent-acp` is installed globally and `claude-agent-acp` is available on the same `PATH` used by acpella, registering the binary directly is also fine:

```bash
acpella exec /agent new claude claude-agent-acp
```

Make Claude the default for future sessions:

```bash
acpella exec /agent default claude
```

## Authentication And Billing

Claude subscription authentication and Anthropic API key billing are separate paths. If the intent is to use the local Claude Code subscription login, avoid leaking `ANTHROPIC_API_KEY` into the adapter process:

```bash
acpella exec /agent new claude env -u ANTHROPIC_API_KEY claude-agent-acp
```

If the intent is API-key billing, provide the key through the process environment managed by the operator instead of writing secrets into acpella state.

## Model Selection

Set the default model for new Claude sessions with `ANTHROPIC_MODEL`:

```bash
acpella exec /agent new claude env -u ANTHROPIC_API_KEY ANTHROPIC_MODEL=sonnet claude-agent-acp
```

`claude-agent-acp` also exposes model selection as an ACP session config option, but acpella may not expose every backend config option through slash commands. Register separate model-specific agents when switching models by session is the desired workflow:

```bash
acpella exec /agent new claude-sonnet env -u ANTHROPIC_API_KEY ANTHROPIC_MODEL=sonnet claude-agent-acp
acpella exec /agent new claude-opus env -u ANTHROPIC_API_KEY ANTHROPIC_MODEL=opus claude-agent-acp
```

## Help

For adapter details, see https://github.com/agentclientprotocol/claude-agent-acp.
