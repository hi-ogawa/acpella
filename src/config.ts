import path from "node:path";
import { z } from "zod";

export interface AppConfig {
  home: string;
  stateFile: string;
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

const envSchema = z
  .object({
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

export function loadConfig(envOverride?: Record<string, string>): AppConfig {
  const env = envSchema.parse({ ...process.env, ...envOverride });
  const home = env.ACPELLA_HOME ? path.resolve(env.ACPELLA_HOME) : process.cwd();

  return {
    home,
    stateFile: path.join(home, ".acpella", "state.json"),
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
