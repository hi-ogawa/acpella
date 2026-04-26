import { fileURLToPath } from "node:url";
import { z } from "zod";
import { FileStateManager } from "./lib/utils-node.ts";

const agentSchema = z.object({
  command: z.string().min(1),
});

const agentKeySchema = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9_-]+$/);

const DEFAULT_SESSION_RENEW_HOUR = 4;
export type SessionRenewPolicyString = "off" | "daily" | `daily:${number}`;
export type EffectiveSessionRenewPolicy = { mode: "off" } | { mode: "daily"; atHour: number };

const sessionRenewPolicySchema = z.custom<SessionRenewPolicyString>(
  (value) => typeof value === "string" && parseSessionRenewPolicy(value) !== undefined,
  { message: "renew must be off, daily, or daily:<0-23>" },
);

const stateSessionSchema = z.object({
  agentKey: agentKeySchema,
  agentSessionId: z.string().min(1).optional(),
  verbose: z.boolean().optional(),
  renew: sessionRenewPolicySchema.optional(),
  updatedAt: z.number().int().nonnegative().optional(),
});

const agentSessionDataSchema = z.object({
  usage: z
    .object({
      used: z.number(),
      size: z.number(),
      updatedAt: z.number(),
    })
    .optional(),
});

const stateSchema = z
  .object({
    version: z.literal(2),
    defaultAgent: agentKeySchema,
    agents: z.record(agentKeySchema, agentSchema),
    sessions: z.record(z.string().min(1), stateSessionSchema),
    // { [agentKey]: { [agentSessionId]: ... }}
    agentSessions: z
      .record(agentKeySchema, z.record(z.string().min(1), agentSessionDataSchema))
      .optional() // for back compat
      .default({}),
  })
  .superRefine((state, ctx) => {
    if (!state.agents[state.defaultAgent]) {
      ctx.addIssue({
        code: "custom",
        message: `defaultAgent does not exist: ${state.defaultAgent}`,
        path: ["defaultAgent"],
      });
    }
    for (const [sessionName, session] of Object.entries(state.sessions)) {
      if (!session.agentKey) {
        ctx.addIssue({
          code: "custom",
          message: "session must include agentKey",
          path: ["sessions", sessionName, "agentKey"],
        });
      }
      if (session.agentKey && !state.agents[session.agentKey]) {
        ctx.addIssue({
          code: "custom",
          message: `session references missing agent: ${session.agentKey}`,
          path: ["sessions", sessionName, "agentKey"],
        });
      }
    }
  });

export const TEST_AGENT_COMMAND = `node ${fileURLToPath(import.meta.resolve("#test-agent"))}`;

function getStateSchemaDefault(): State {
  return {
    version: 2,
    defaultAgent: "test",
    agents: {
      test: { command: TEST_AGENT_COMMAND },
    },
    sessions: {},
    agentSessions: {},
  };
}

export type State = z.infer<typeof stateSchema>;
export type StateSession = State["sessions"][string];
export interface StateAgentSession {
  agentKey: string;
  agentSessionId: string;
}
type AgentSessionData = z.infer<typeof agentSessionDataSchema>;
type AgentSessionUsage = NonNullable<AgentSessionData["usage"]>;

export function parseSessionRenewPolicy(value: string): EffectiveSessionRenewPolicy | undefined {
  if (value === "off") {
    return { mode: "off" };
  }
  if (value === "daily") {
    return { mode: "daily", atHour: DEFAULT_SESSION_RENEW_HOUR };
  }
  const match = /^daily:(\d+)$/.exec(value);
  if (!match) {
    return;
  }
  const atHour = Number(match[1]);
  if (!Number.isInteger(atHour) || atHour < 0 || atHour > 23) {
    return;
  }
  return { mode: "daily", atHour };
}

export function resolveSessionRenewPolicy(
  value: SessionRenewPolicyString | undefined,
): EffectiveSessionRenewPolicy {
  if (!value) {
    return { mode: "daily", atHour: DEFAULT_SESSION_RENEW_HOUR };
  }
  const policy = parseSessionRenewPolicy(value);
  if (!policy) {
    throw new Error(`Invalid session renewal policy: ${value}`);
  }
  return policy;
}

export function renderSessionRenewPolicy(
  policy: EffectiveSessionRenewPolicy,
  timezone: string,
): string {
  switch (policy.mode) {
    case "off": {
      return "off";
    }
    case "daily": {
      return `daily at ${String(policy.atHour).padStart(2, "0")}:00 ${timezone}`;
    }
  }
}

function getSessionRenewBoundary(options: {
  now: number;
  timezone: string;
  atHour: number;
}): number {
  const instant = Temporal.Instant.fromEpochMilliseconds(options.now);
  const zoned = instant.toZonedDateTimeISO(options.timezone);
  let boundary = Temporal.ZonedDateTime.from({
    timeZone: options.timezone,
    year: zoned.year,
    month: zoned.month,
    day: zoned.day,
    hour: options.atHour,
  });
  if (boundary.epochMilliseconds > options.now) {
    boundary = boundary.subtract({ days: 1 });
  }
  return boundary.epochMilliseconds;
}

export function shouldRenewSession(options: {
  session: StateSession;
  now: number;
  timezone: string;
}): boolean {
  if (!options.session.agentSessionId || options.session.updatedAt === undefined) {
    return false;
  }
  const policy = resolveSessionRenewPolicy(options.session.renew);
  if (policy.mode === "off") {
    return false;
  }
  return (
    options.session.updatedAt <
    getSessionRenewBoundary({
      now: options.now,
      timezone: options.timezone,
      atHour: policy.atHour,
    })
  );
}

export class SessionStateStore {
  file: FileStateManager<State>;

  constructor(file: string) {
    this.file = new FileStateManager<State>({
      file,
      parse: stateSchema.parse.bind(stateSchema),
      defaultValue: getStateSchemaDefault,
    });
  }

  get(): State {
    return this.file.state;
  }

  set(updater: (state: State) => void): void {
    this.file.set(updater);
  }

  getSession(sessionName: string): StateSession {
    const state = this.get();
    const session = state.sessions[sessionName];
    return {
      ...session,
      agentKey: session?.agentKey ?? state.defaultAgent,
      verbose: session?.verbose ?? false,
    };
  }

  setSession(sessionName: string, patch: Partial<StateSession>): void {
    this.set((state) => {
      state.sessions[sessionName] = {
        ...this.getSession(sessionName),
        ...patch,
      };
    });
  }

  deleteSession(target: StateAgentSession): void {
    this.set((state) => {
      for (const [name, session] of Object.entries(state.sessions)) {
        if (
          session.agentKey === target.agentKey &&
          session.agentSessionId === target.agentSessionId
        ) {
          delete state.sessions[name];
        }
      }
    });
  }

  getAgentSessionUsage(target: StateAgentSession): AgentSessionUsage | undefined {
    return this.file.state.agentSessions[target.agentKey]?.[target.agentSessionId]?.usage;
  }

  setAgentSessionUsage(
    target: StateAgentSession,
    usage: Omit<AgentSessionUsage, "updatedAt">,
  ): void {
    this.set((state) => {
      state.agentSessions[target.agentKey] ??= {};
      state.agentSessions[target.agentKey][target.agentSessionId] ??= {};
      state.agentSessions[target.agentKey][target.agentSessionId].usage = {
        used: usage.used,
        size: usage.size,
        updatedAt: Date.now(),
      };
    });
  }
}

export function toAgentSessionKey(options: StateAgentSession): string {
  return `${options.agentKey}:${options.agentSessionId}`;
}

export function parseAgentSessionKey(fullKey: string): {
  agentKey?: string;
  agentSessionId: string;
} {
  const sep = fullKey.indexOf(":");
  if (sep === -1) {
    return {
      agentSessionId: fullKey,
    };
  }
  return {
    agentKey: fullKey.slice(0, sep),
    agentSessionId: fullKey.slice(sep + 1),
  };
}
