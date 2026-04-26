import fs from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { loadEnvFile } from "node:process";

export function loadEnv(options: { file?: string }) {
  const env = process.env;
  const file = options.file
    ? path.resolve(process.cwd(), options.file)
    : resolveDefaultEnvFile(env);

  if (!fs.existsSync(file)) {
    if (options.file !== undefined) {
      throw new Error(`Env file not found: ${file}`);
    }
    return;
  }
  loadEnvFile(file);
}

function resolveDefaultEnvFile(env: NodeJS.ProcessEnv): string {
  const configHome = env.XDG_CONFIG_HOME
    ? path.resolve(env.XDG_CONFIG_HOME)
    : path.join(homedir(), ".config");
  return path.join(configHome, "acpella", ".env");
}
