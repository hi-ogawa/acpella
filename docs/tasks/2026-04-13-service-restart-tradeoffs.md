# Safe Service Restart Tradeoffs

## Problem Context

Issue: <https://github.com/hi-ogawa/acpella/issues/22>

acpella may need a local service restart command after its code or runtime configuration changes. A restart triggered from inside the active Telegram conversation path has a timing hazard: if the process restarts before the acknowledgement is fully sent, the user may not receive confirmation and Telegram delivery state may become ambiguous.

The key requirement is not just "restart the service", but "acknowledge the command first, then perform the restart from a control path that is not fragile when the current `acpella.service` process is stopped."

## Clarified Systemd Detail

The proposed unit name `acpella-self-restart` is not expected to be a permanent unit file. It is a transient systemd unit name created on demand by `systemd-run`.

Example:

```bash
systemd-run --user --on-active=3s --collect --unit=acpella-self-restart systemctl --user restart acpella
```

Important parts:

- `systemd-run --user` asks the user systemd manager to run a command as its own temporary unit.
- `--on-active=3s` delays execution so the Telegram acknowledgement has time to flush.
- `--collect` lets systemd clean up the transient unit after it finishes.
- `--unit=acpella-self-restart` gives the temporary unit a readable/debuggable name.
- The final command is still `systemctl --user restart acpella`; the difference is that systemd owns the delayed execution.

The transient unit may not appear in `systemctl --user list-units` except while it is queued, running, failed, or recently completed.

## Approach Tradeoffs

### Direct `systemctl --user restart acpella`

This is straightforward for manual shell usage or an external CLI command.

Tradeoffs:

- Simple and familiar.
- Uses the same service manager that owns `acpella.service`.
- Risky from inside the live acpella message path because the process can be stopped before the acknowledgement finishes sending.
- Does not provide a built-in delay unless wrapped by some other mechanism.

### Child Process Delay

Example shape:

```bash
sleep 3 && systemctl --user restart acpella
```

Tradeoffs:

- Simple to express.
- Can delay long enough for an acknowledgement to be sent.
- Fragile when launched from inside `acpella.service`: the child process can remain in the service cgroup and be killed when systemd stops the service.
- Requires extra care around detaching stdio/process groups, and still may not be as robust as handing the job to systemd.

### Transient `systemd-run` Unit

Example shape:

```bash
systemd-run --user --on-active=3s --collect --unit=acpella-self-restart systemctl --user restart acpella
```

Tradeoffs:

- Moves delayed execution outside the current service process tree.
- Gives systemd ownership of the pending restart job.
- Allows acpella to send an acknowledgement before the restart command executes.
- Avoids relying on a child `sleep` process surviving service shutdown.
- Depends on user systemd being available and healthy.
- A fixed transient unit name is easier to inspect but may collide if repeated while a prior restart unit is still pending.

### In-Process Signal Restart

OpenClaw has an in-chat `/restart` path that can schedule a SIGUSR1-driven restart inside its gateway process.

Tradeoffs:

- Lets the application coordinate restart with its own lifecycle state.
- Can drain active work, reject new work, coalesce duplicate restart requests, and apply cooldowns.
- Requires a dedicated signal-aware run loop and restart authorization model.
- The scheduled restart is only as durable as the current process. If the process is wedged or killed before the timer/signal path runs, the pending restart is lost.
- Depending on runtime mode, it may become an in-process server rebuild rather than a fresh process restart, which may not reload updated code.

### Supervisor-Owned Restart

OpenClaw can also exit and rely on launchd/systemd/schtasks to relaunch the gateway when supervisor markers are detected. Its generated systemd unit uses `Restart=always`, so a clean process exit can be treated as a service restart.

Tradeoffs:

- Good when the service unit is known to have a restart policy.
- Keeps restart responsibility with the supervisor.
- Depends on the service actually being configured for automatic restart.
- If the service is run manually or under a custom unit without a restart policy, exiting may stop it instead of restarting it.

### Detached Self-Respawn

OpenClaw also has a fallback path for non-supervised Unix processes where the parent spawns a detached child with the same Node executable and argv, then exits.

Tradeoffs:

- Can achieve a fresh process without a service manager.
- Useful for manually run long-lived processes.
- More complex than supervisor-owned restart.
- Has platform-specific caveats and can orphan or duplicate processes if locking and lifecycle handling are not correct.

## OpenClaw Reference Points

- Chat `/restart` command handling: `refs/openclaw/src/auto-reply/reply/commands-session.ts`
- Restart scheduling and SIGUSR1 authorization: `refs/openclaw/src/infra/restart.ts`
- Gateway run loop restart handling: `refs/openclaw/src/cli/gateway-cli/run-loop.ts`
- Fresh-process respawn helper: `refs/openclaw/src/infra/process-respawn.ts`
- Platform service registry: `refs/openclaw/src/daemon/service.ts`
- Linux systemd restart path: `refs/openclaw/src/daemon/systemd.ts`
- Generated OpenClaw systemd unit settings: `refs/openclaw/src/daemon/systemd-unit.ts`

## Open Questions

- Should repeated restart requests use a fixed transient unit name for debug visibility or unique names to avoid collisions?
- What user-visible message should be shown if scheduling the restart fails?
- Should the restart command surface only one alias, or support both `/restart` and `/service restart`?
- How much, if any, status output from `systemd-run` should be logged for later diagnostics?
