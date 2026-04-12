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
  testChatId: number;
}

const builtinAgents: Record<string, string> = {
  codex: path.join(
    import.meta.dirname,
    "..",
    "node_modules/@zed-industries/codex-acp/bin/codex-acp.js",
  ),
  test: `node ${path.join(import.meta.dirname, "lib/test-agent.ts")}`,
};

const envSchema = z
  .object({
    ACPELLA_AGENT: z.string().optional(),
    ACPELLA_HOME: z.string().optional(),
    ACPELLA_TELEGRAM_BOT_TOKEN: z.string().optional(),
    ACPELLA_TELEGRAM_ALLOWED_USER_IDS: z.string().optional(),
    ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS: z.string().optional(),
    ACPELLA_TEST_CHAT_ID: z.string().optional(),
  })
  .loose();

export function loadConfig(): AppConfig {
  const env = envSchema.parse(process.env);
  const home = env.ACPELLA_HOME ? path.resolve(env.ACPELLA_HOME) : process.cwd();

  const agentName = env.ACPELLA_AGENT ?? "codex";
  const agent = resolveAgent({ name: agentName });

  return {
    agent,
    home,
    stateFile: path.join(home, ".acpella", "state.json"),
    telegram: {
      token: env.ACPELLA_TELEGRAM_BOT_TOKEN,
      allowedUserIds: parseIdList(env.ACPELLA_TELEGRAM_ALLOWED_USER_IDS) ?? [],
      allowedChatIds: parseIdList(env.ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS) ?? [],
    },
    // TODO: make use of this for test
    testChatId: parseOptionalId(env.ACPELLA_TEST_CHAT_ID) ?? 10101010,
  };
}

function resolveAgent(options: { name: string }): AppConfig["agent"] {
  const alias = options.name;
  const knownAgent = builtinAgents[alias];
  if (knownAgent) {
    return { alias, command: knownAgent };
  }
  return { alias, command: alias };
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
