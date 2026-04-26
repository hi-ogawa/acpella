# Architecture

## Purpose

acpella is a drastically simplified OpenClaw replacement: a small service that connects Telegram conversations to an ACP-compatible AI agent. The goal is to keep messaging, routing, and safety policy in acpella while leaving agent memory, tool execution, workspace behavior, and model-specific features to the agent.

Telegram is the first messaging surface; ACP is the agent boundary, so the service can use different ACP agents without redesigning the messaging layer.

## System Model

```text
Telegram / local REPL
  -> acpella conversation router
  -> ACP agent adapter
  -> AI agent
```

The messaging side handles identity, chat/thread context, and replies. The router decides whether a message is a local service command or an agent prompt. The ACP side talks to the selected agent and returns assistant text.

## Conversation Model

Each Telegram conversation maps to one agent conversation. Direct chats and normal group chats use the chat id. Forum topics include the thread id so separate topics do not share context.

acpella stores only the lightweight mapping needed to reconnect a messaging conversation to an agent conversation. Session mappings can renew lazily on prompt boundaries, by default daily at 04:00 in the service timezone, so long-running chats and scheduled prompts do not keep one ACP context forever. The agent owns its own memory, workspace state, tool execution, and resumability.

## Operational Model

Telegram access is restricted by a required user allowlist and an optional chat allowlist. Local service commands are handled by acpella and are not sent to the agent.

The service is restartable: local conversation mappings are kept on disk, while deeper agent state remains with the agent. If the agent cannot start, cannot resume a conversation, or fails during a prompt, acpella reports a bounded error back to the messaging surface.

## Tradeoffs

acpella intentionally keeps little state and avoids a database. Responses are currently returned after the agent finishes rather than streamed. Message queueing, Telegram formatting, long-message splitting, and scheduled prompts are delivery-layer features that can be added without changing the ACP boundary.
