import fs from "node:fs";
import { onTestFinished, vi } from "vitest";
import { loadConfig, type AppConfig } from "../config.ts";
import { createHandler, type HandlerContext } from "../handler.ts";
import { CronRunner } from "../lib/cron/runner.ts";
import { CronStore } from "../lib/cron/store.ts";
import { useFs } from "./helper.ts";

export async function createHandlerTester() {
  const { root } = useFs({ prefix: "handler" });
  const config = loadConfig({
    envFile: false,
    envOverride: {
      ACPELLA_HOME: root,
      TEST_ACPELLA_TIMEZONE: "Asia/Jakarta",
    },
  });

  const cronStore = new CronStore({
    cronFile: config.cronFile,
    cronStateFile: config.cronStateFile,
  });
  const cronDeliveries: string[] = [];
  const cronRunner = new CronRunner({
    store: cronStore,
    agent: {
      prompt: (options) => handler.prompt(options),
    },
    delivery: {
      send: async ({ text }) => {
        cronDeliveries.push(text);
      },
    },
  });

  const onServiceExit = vi.fn();
  const handler = await createHandler(config, {
    version: "v1.0.0-test",
    onServiceExit,
    cronStore,
    getCronRunner: () => cronRunner,
  });
  onTestFinished(() => {
    handler.stop();
  });

  async function request(context: Omit<HandlerContext, "send">) {
    const replies: string[] = [];
    await handler.handle({
      ...context,
      send: async (t) => replies.push(t),
    });
    return sanitizeOutput(replies.join("\n"), config);
  }

  function requestStream(context: Omit<HandlerContext, "send">) {
    const replies: string[] = [];
    const promise = handler.handle({
      ...context,
      send: async (t) => replies.push(sanitizeOutput(t, config)),
    });
    return {
      promise,
      replies,
    };
  }

  function createSession(sessionName: string, context?: Partial<HandlerContext>) {
    return {
      request: (text: string) => request({ ...context, sessionName, text }),
      requestStream: (text: string) => requestStream({ ...context, sessionName, text }),
    };
  }

  function readStateFile() {
    const stateFile = config.stateFile;
    if (!fs.existsSync(stateFile)) {
      return null;
    }
    return sanitizeOutput(fs.readFileSync(stateFile, "utf8"), config);
  }

  return {
    config,
    request,
    requestStream,
    createSession,
    readStateFile,
    onServiceExit,
    cronStore,
    cronRunner,
    cronDeliveries,
  };
}

export function sanitizeOutput(output: string, config: AppConfig) {
  return output
    .replaceAll(config.home, () => "<home>")
    .replaceAll(process.cwd(), () => "<cwd>")
    .replaceAll(/"t":(\d+|"[^"]+")/g, `"t":"<time>"`)
    .replaceAll(/"updatedAt": \d+/g, `"updatedAt": <time>`);
}
