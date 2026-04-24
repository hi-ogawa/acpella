import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export type LoadedEnvFile = {
  path: string;
  explicit: boolean;
  loaded: boolean;
};

export function loadCliEnvFile(options: {
  envFile?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
}): LoadedEnvFile {
  const env = options.env ?? process.env;
  const explicit = Boolean(options.envFile);
  const envFile = options.envFile
    ? resolve(options.envFile)
    : resolve(
        env.XDG_CONFIG_HOME?.trim() || resolve(options.home ?? homedir(), ".config"),
        "acpella/.env",
      );

  if (!explicit && !existsSync(envFile)) {
    return {
      path: envFile,
      explicit,
      loaded: false,
    };
  }

  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    if (explicit) {
      throw new Error(`Failed to load env file: ${envFile}`, { cause: error });
    }
    return {
      path: envFile,
      explicit,
      loaded: false,
    };
  }

  return {
    path: envFile,
    explicit,
    loaded: true,
  };
}
