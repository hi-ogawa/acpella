# OpenCode ACP

Use this reference when registering or changing acpella's OpenCode ACP backend.

## Registration

`acpella-opencode-acp` is acpella's local OpenCode ACP adapter binary. Register it like any other ACP agent:

```bash
acpella exec /agent new opencode acpella-opencode-acp
```

Make OpenCode the default for future sessions:

```bash
acpella exec /agent default opencode
```

## Upstream OpenCode ACP

OpenCode also provides its own `opencode acp` command. Prefer `acpella-opencode-acp` for acpella unless explicitly testing upstream behavior.

The upstream adapter is known to have compatibility issues in this setup and is likely larger than acpella needs. The local adapter intentionally keeps a narrower surface for acpella's session, streaming, usage, and model-selection workflow.

## Model Selection

Pass `--model <provider/model>` to set OpenCode's default model for the adapter process:

```bash
acpella exec /agent new opencode acpella-opencode-acp --model openai/gpt-5.5
```

Use `opencode models` to list available provider/model values before choosing the `--model` target.

## OpenCode Feature Flags

OpenCode gates some features behind environment variables. Bake those into the registered agent command when needed.

For example, enable EXA for every acpella session that uses this agent:

```bash
acpella exec /agent new opencode env OPENCODE_ENABLE_EXA=1 acpella-opencode-acp
```

Feature flags can be combined with adapter flags:

```bash
acpella exec /agent new opencode env OPENCODE_ENABLE_EXA=1 acpella-opencode-acp --model openai/gpt-5.5
```

## Help

For the adapter's supported CLI options, run:

```bash
acpella-opencode-acp --help
```

`--help` is a human CLI mode. It prints usage and exits before starting ACP stdio.
