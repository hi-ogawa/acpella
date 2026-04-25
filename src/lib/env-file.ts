import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseEnv } from "node:util";

export function loadEnvFile(options: { file?: string; cwd?: string; env?: NodeJS.ProcessEnv }): {
  file: string;
  loaded: boolean;
} {
  const env = options.env ?? process.env;
  const file = options.file
    ? path.resolve(options.cwd ?? process.cwd(), options.file)
    : resolveDefaultEnvFile(env);

  if (!fs.existsSync(file)) {
    if (options.file) {
      throw new Error(`Env file not found: ${file}`);
    }
    return {
      file,
      loaded: false,
    };
  }

  const parsed = parseEnv(fs.readFileSync(file, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) {
      env[key] = value;
    }
  }
  return {
    file,
    loaded: true,
  };
}

function resolveDefaultEnvFile(env: NodeJS.ProcessEnv): string {
  const configHome = env.XDG_CONFIG_HOME
    ? path.resolve(env.XDG_CONFIG_HOME)
    : path.join(homedir(), ".config");
  return path.join(configHome, "acpella", ".env");
}
