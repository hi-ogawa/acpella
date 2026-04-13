import path from "node:path";
import { z } from "zod";

export interface AppConfig {
  agent: {
    alias: string;
    command: string;
  };
  home: string;
  stateFile: string;
  /** Scheduled cron job definitions. */
  cronFile: string;
  /** Volatile cron execution state (last run, duplicate prevention). */
  cronStateFile: string;
  telegram: {
    token?: string;
    allowedUserIds: number[];
    allowedChatIds: number[];
  };
  /** Conventional custom-instructions file, read lazily when creating a new session. */
  prompt: {
    file: string;
  };
  testChatId: number;
}

const builtinAgents: Record<string, string> = {
  test: `node ${path.join(import.meta.dirname, "lib/test-agent.ts")}`,
};

const envSchema = z
  .object({
    ACPELLA_AGENT: z.string().default("test"),
    ACPELLA_HOME: z.string().optional(),
    ACPELLA_TELEGRAM_BOT_TOKEN: z.string().optional(),
    ACPELLA_TELEGRAM_ALLOWED_USER_IDS: z.string().optional(),
    ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS: z.string().optional(),
    ACPELLA_TEST_CHAT_ID: z
      .string()
      .optional()
      .transform((value) => (value?.trim() ? value : "10101010")),
  })
  .loose();

export function loadConfig(): AppConfig {
  const env = envSchema.parse(process.env);
  const home = env.ACPELLA_HOME ? path.resolve(env.ACPELLA_HOME) : process.cwd();

  const agentAlias = env.ACPELLA_AGENT;
  const agentCommand = builtinAgents[agentAlias] || agentAlias;

  return {
    agent: { alias: agentAlias, command: agentCommand },
    home,
    stateFile: path.join(home, ".acpella", "state.json"),
    cronFile: path.join(home, ".acpella", "cron.json"),
    cronStateFile: path.join(home, ".acpella", "cron-state.json"),
    telegram: {
      token: env.ACPELLA_TELEGRAM_BOT_TOKEN,
      allowedUserIds: parseIdList(env.ACPELLA_TELEGRAM_ALLOWED_USER_IDS) ?? [],
      allowedChatIds: parseIdList(env.ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS) ?? [],
    },
    prompt: {
      file: path.join(home, ".acpella", "AGENTS.md"),
    },
    // TODO: make use of this for test
    testChatId: parseId(env.ACPELLA_TEST_CHAT_ID),
  };
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

function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id)) {
    throw new Error(`Invalid numeric id: ${value}`);
  }
  return id;
}
