import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

export interface AppConfig {
  agent: {
    alias: string;
    command: string;
  };
  home: string;
  stateFile: string;
  telegram: {
    token?: string;
    allowedUserIds: number[];
    allowedChatIds: number[];
  };
  testMode: boolean;
  testChatId: number;
}

interface AgentAlias {
  command: string;
}

const CONFIG_FILE = "acpella.config.json";

const builtinAgents: Record<string, AgentAlias> = {
  codex: {
    command: path.join(
      import.meta.dirname,
      "..",
      "node_modules/@zed-industries/codex-acp/bin/codex-acp.js",
    ),
  },
  test: {
    command: `node ${path.join(import.meta.dirname, "lib/test-agent.ts")}`,
  },
};

const rawAgentSchema = z.object({
  command: z.string().min(1),
});

const rawConfigSchema = z
  .object({
    version: z.literal(1),
    agent: z.string().min(1).optional(),
    agents: z.record(z.string().min(1), rawAgentSchema).optional(),
    telegram: z
      .object({
        allowedUserIds: z.array(z.number().int()).optional(),
        allowedChatIds: z.array(z.number().int()).optional(),
      })
      .optional(),
  })
  .strict();

const envSchema = z
  .object({
    ACPELLA_CONFIG: z.string().optional(),
    ACPELLA_AGENT: z.string().optional(),
    ACPELLA_HOME: z.string().optional(),
    ACPELLA_TELEGRAM_BOT_TOKEN: z.string().optional(),
    ACPELLA_TELEGRAM_ALLOWED_USER_IDS: z.string().optional(),
    ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS: z.string().optional(),
    ACPELLA_TEST_BOT: z.string().optional(),
    ACPELLA_TEST_CHAT_ID: z.string().optional(),
  })
  .loose();

export function loadConfig(): AppConfig {
  const env = envSchema.parse(process.env);
  const home = env.ACPELLA_HOME ? path.resolve(env.ACPELLA_HOME) : process.cwd();
  const defaultConfigPath = path.join(home, CONFIG_FILE);
  const configPath = env.ACPELLA_CONFIG
    ? path.resolve(env.ACPELLA_CONFIG)
    : fs.existsSync(defaultConfigPath)
      ? defaultConfigPath
      : undefined;
  const fileConfig = configPath
    ? rawConfigSchema.parse(JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown)
    : undefined;
  const configDir = configPath ? path.dirname(configPath) : home;

  const agents = resolveAgents({
    configDir,
    fileAgents: fileConfig?.agents,
  });

  const agentName = env.ACPELLA_AGENT ?? fileConfig?.agent ?? "codex";
  const agent = resolveAgent({ agents, name: agentName });

  return {
    agent,
    home,
    stateFile: path.join(home, ".acpella", "state.json"),
    telegram: {
      token: env.ACPELLA_TELEGRAM_BOT_TOKEN,
      allowedUserIds:
        parseIdList(env.ACPELLA_TELEGRAM_ALLOWED_USER_IDS) ??
        fileConfig?.telegram?.allowedUserIds ??
        [],
      allowedChatIds:
        parseIdList(env.ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS) ??
        fileConfig?.telegram?.allowedChatIds ??
        [],
    },
    testMode: env.ACPELLA_TEST_BOT === "1",
    testChatId: parseOptionalId(env.ACPELLA_TEST_CHAT_ID) ?? 123,
  };
}

function resolveAgents(options: {
  configDir: string;
  fileAgents: Record<string, AgentAlias> | undefined;
}): Record<string, AgentAlias> {
  const fileAgents = Object.fromEntries(
    Object.entries(options.fileAgents ?? {}).map(([alias, agent]) => [
      alias,
      { command: resolveCommand({ command: agent.command, baseDir: options.configDir }) },
    ]),
  );
  return { ...builtinAgents, ...fileAgents };
}

function resolveAgent(options: {
  agents: Record<string, AgentAlias>;
  name: string;
}): AppConfig["agent"] {
  const alias = options.name;
  const knownAgent = options.agents[alias];
  if (knownAgent) {
    return { alias, command: knownAgent.command };
  }
  return { alias, command: resolveCommand({ command: alias, baseDir: process.cwd() }) };
}

function resolveCommand(options: { command: string; baseDir: string }): string {
  const [cmd, ...args] = options.command.trim().split(/\s+/);
  if (!cmd) {
    throw new Error("Agent command must be non-empty");
  }
  const resolvedCmd =
    cmd.includes(path.sep) && !path.isAbsolute(cmd) ? path.resolve(options.baseDir, cmd) : cmd;
  return [resolvedCmd, ...args].join(" ");
}

function parseIdList(value: string | undefined): number[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.trim() === "") {
    return [];
  }
  return value.split(",").map((part) => {
    const id = Number(part.trim());
    if (!Number.isInteger(id)) {
      throw new Error(`Invalid numeric id: ${part}`);
    }
    return id;
  });
}

function parseOptionalId(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const id = Number(value);
  if (!Number.isInteger(id)) {
    throw new Error(`Invalid numeric id: ${value}`);
  }
  return id;
}
