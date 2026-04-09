# References

Projects to reference for ideas and integration patterns.

## Key projects

| Project                                                                     | What to learn                                                    |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [acpx](https://github.com/openclaw/acpx)                                    | ACP CLI we shell out to — session lifecycle, prompt format       |
| [ACP spec](https://github.com/agentclientprotocol/agent-client-protocol)    | Protocol details, message types, session model                   |
| [ACP TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk) | If we ever speak ACP directly instead of via acpx                |
| [nanoclaw](https://github.com/qwibitai/nanoclaw)                            | Same architecture (thin coordinator + agent), patterns to borrow |
| [telegram-acp-bot](https://github.com/mgaitan/telegram-acp-bot)             | Closest prior art — Telegram + ACP, scheduling, session commands |
| [grammy](https://github.com/grammyjs/grammY)                                | Telegram bot framework we use                                    |

## What to look at

| Ref                  | Focus                                                                |
| -------------------- | -------------------------------------------------------------------- |
| **acpx**             | CLI flags, `sessions ensure/close/list`, `--format json` output      |
| **ACP spec**         | `session/update` message schema, `agent_message_chunk`, stop reasons |
| **ACP TS SDK**       | If removing the acpx subprocess dependency                           |
| **nanoclaw**         | Session lifecycle, cron patterns, memory file conventions            |
| **telegram-acp-bot** | Typing indicator, file attachments, permission prompts as buttons    |
| **grammy**           | Middleware, `ctx.reply`, message splitting helpers                   |

## Local setup

Clone into `refs/` (gitignored):

```bash
git clone --depth 1 https://github.com/openclaw/acpx refs/acpx
git clone --depth 1 https://github.com/agentclientprotocol/agent-client-protocol refs/acp-spec
git clone --depth 1 https://github.com/agentclientprotocol/typescript-sdk refs/acp-ts-sdk
git clone --depth 1 https://github.com/qwibitai/nanoclaw refs/nanoclaw
git clone --depth 1 https://github.com/mgaitan/telegram-acp-bot refs/telegram-acp-bot
git clone --depth 1 https://github.com/grammyjs/grammY refs/grammy
```
