import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { z } from "zod";

export interface AppConfig {
  envFile?: string;
  home: string;
  stateFile: string;
  cronFile: string;
  cronStateFile: string;
  logsDir: string;
  timezone: string;
  telegram: {
    token?: string;
    allowedUserIds: number[];
    allowedChatIds: number[];
  };
  /** Conventional custom-instructions file, read lazily when creating a new session. */
  prompt: {
    file: string;
  };
}

const envSchema = z
  .object({
    ACPELLA_HOME: z.string().optional(),
    ACPELLA_TELEGRAM_BOT_TOKEN: z.string().optional(),
    ACPELLA_TELEGRAM_ALLOWED_USER_IDS: z.string().optional(),
    ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS: z.string().optional(),
    // pin timezone to make tests deterministic on local and CI
    TEST_ACPELLA_TIMEZONE: z.string().optional(),
  })
  .loose();

export function loadConfig(options: {
  envFile?: string | false;
  envOverride?: Record<string, string>;
}): AppConfig {
  let envFile: string | undefined;
  if (options.envFile !== false) {
    const explicit = options.envFile !== undefined;
    envFile = options.envFile
      ? path.resolve(process.cwd(), options.envFile)
      : resolveDefaultEnvFile({ ...process.env, ...options.envOverride });
    if (fs.existsSync(envFile)) {
      loadEnvFile(envFile);
    } else if (explicit) {
      throw new Error(`Env file not found: ${envFile}`);
    }
  }

  const env = envSchema.parse({ ...process.env, ...options.envOverride });
  const home = env.ACPELLA_HOME ? path.resolve(env.ACPELLA_HOME) : process.cwd();

  return {
    envFile,
    home,
    stateFile: path.join(home, ".acpella", "state.json"),
    cronFile: path.join(home, ".acpella", "cron.json"),
    cronStateFile: path.join(home, ".acpella", "cron-state.json"),
    logsDir: path.join(home, ".acpella", "logs"),
    timezone: env.TEST_ACPELLA_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    telegram: {
      token: env.ACPELLA_TELEGRAM_BOT_TOKEN,
      allowedUserIds: parseIdList(env.ACPELLA_TELEGRAM_ALLOWED_USER_IDS) ?? [],
      allowedChatIds: parseIdList(env.ACPELLA_TELEGRAM_ALLOWED_CHAT_IDS) ?? [],
    },
    prompt: {
      file: path.join(home, ".acpella", "AGENTS.md"),
    },
  };
}

function resolveDefaultEnvFile(env: NodeJS.ProcessEnv): string {
  const configHome = env.XDG_CONFIG_HOME
    ? path.resolve(env.XDG_CONFIG_HOME)
    : path.join(homedir(), ".config");
  return path.join(configHome, "acpella", ".env");
}

function parseIdList(value: string | undefined): number[] | undefined {
  if (value === undefined) {
    return;
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
