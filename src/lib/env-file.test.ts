import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadEnvFile } from "./env-file.ts";

// TODO: move to e2e

describe(loadEnvFile, () => {
  it("loads default env file without overriding existing env", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acpella-env-file-"));
    const envDir = path.join(tmpDir, "acpella");
    fs.mkdirSync(envDir, { recursive: true });
    fs.writeFileSync(
      path.join(envDir, ".env"),
      "ACPELLA_TELEGRAM_BOT_TOKEN=from-file\nOPENAI_API_KEY=from-file\n",
    );

    const env: NodeJS.ProcessEnv = {
      XDG_CONFIG_HOME: tmpDir,
      OPENAI_API_KEY: "from-process",
    };
    expect(loadEnvFile({ env })).toEqual({
      file: path.join(envDir, ".env"),
      loaded: true,
    });
    expect(env.ACPELLA_TELEGRAM_BOT_TOKEN).toBe("from-file");
    expect(env.OPENAI_API_KEY).toBe("from-process");
  });

  it("ignores missing default env file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acpella-env-file-"));
    const env: NodeJS.ProcessEnv = {
      XDG_CONFIG_HOME: tmpDir,
    };

    expect(loadEnvFile({ env })).toEqual({
      file: path.join(tmpDir, "acpella", ".env"),
      loaded: false,
    });
  });

  it("fails for missing explicit env file", () => {
    expect(() =>
      loadEnvFile({
        file: "./missing.env",
        cwd: "/tmp/acpella",
        env: {},
      }),
    ).toThrowError("Env file not found: /tmp/acpella/missing.env");
  });
});
