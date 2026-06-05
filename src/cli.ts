import "temporal-polyfill/global";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { serveDiscord } from "./channel/discord.ts";
import { serveTelegram } from "./channel/telegram.ts";
import { loadConfig, type AppConfig } from "./config.ts";
import { createHandler, type Handler } from "./handler.ts";
import { parseCli } from "./lib/cli.ts";
import { CronRunner } from "./lib/cron/runner.ts";
import { type CronDeliveryTarget, CronStore } from "./lib/cron/store.ts";
import { getVersion } from "./lib/version.ts";

const CLI_HELP = `\
Usage: acpella [command]

Commands:
  serve             Run bot service. Default when no command is provided.
  repl              Run local in-process REPL.
  exec <message...> Run one local message, then exit.

Options:
  --env-file <path> Use this env file for config resolution.
  --channel <name>  Service channel for \`serve\` (telegram or discord, default: telegram).
  -h, --help        Show this help.
`;

async function main() {
  const cliArgv = process.argv.slice(2);
  if (cliArgv.some((arg) => ["-h", "--help"].includes(arg))) {
    console.log(CLI_HELP);
    return;
  }

  const cli = parseCli({
    argv: cliArgv,
    commands: ["serve", "repl", "exec"],
    defaultCommand: "serve",
  });
  const channel = cli.channel ?? "telegram";

  if (cli.command !== "exec" && cli.args.length > 0) {
    throw new Error(`\
Unexpected arguments for ${cli.command}: ${cli.args.join(" ")}

${CLI_HELP}`);
  }

  if (cli.command === "exec" && cli.args.length === 0) {
    throw new Error(`\
Missing message for exec

${CLI_HELP}`);
  }
  if (cli.channel && cli.command !== "serve") {
    throw new Error(`--channel can only be used with serve`);
  }
  if (cli.command === "serve" && !["telegram", "discord"].includes(channel)) {
    throw new Error(`Invalid --channel: ${channel}`);
  }

  const config = loadConfig({
    envFile: cli.envFile,
  });
  const version = await getVersion({ cwd: path.join(import.meta.dirname, "..") });
  const cronStore = new CronStore({
    cronFile: config.cronFile,
    cronStateFile: config.cronStateFile,
  });
  let handleCronDelivery = async (_target: CronDeliveryTarget, _text: string): Promise<void> => {};
  const cronRunner = new CronRunner({
    store: cronStore,
    agent: {
      prompt: (...args) => handler.prompt(...args),
    },
    delivery: {
      send: async ({ target, text }) => {
        if (target.repl) {
          console.log("[cron] repl delivery:", text);
          console.log(text);
        }
        if (cli.command === "serve") {
          await handleCronDelivery(target, text);
        }
      },
    },
  });

  const handler = await createHandler(config, {
    version,
    onServiceExit: () => {
      setImmediate(() => {
        console.log("Exiting by /service exit");
        process.exit(0);
      });
    },
    cronStore,
    // TODO: break handler <-> cronRunner cycle
    // docs/tasks/2026-04-19-agent-session-service-architecture.md
    getCronRunner: () => cronRunner,
  });
  handler.start();

  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => handler.stop());
  cleanup.defer(() => cronRunner.stop());

  if (cli.command === "repl") {
    await startRepl({ config, handler, version });
    return;
  }

  if (cli.command === "exec") {
    await runExec({ handler, text: cli.args.join(" ") });
    return;
  }
  cronRunner.start();
  if (channel === "telegram") {
    await serveTelegram({
      config,
      handler,
      version,
      setCronDeliveryHandler: (next) => {
        handleCronDelivery = next;
      },
    });
    return;
  }
  await serveDiscord({
    config,
    handler,
    version,
    setCronDeliveryHandler: (next) => {
      handleCronDelivery = next;
    },
  });
}

async function startRepl({
  config,
  handler,
  version,
}: {
  config: AppConfig;
  handler: Handler;
  version: string;
}) {
  console.log(`Starting repl (version: ${version}, home: ${config.home})`);

  let isHandling = false;
  async function sendMessage(text: string) {
    isHandling = true;
    try {
      await runExec({ handler, text });
    } catch (error) {
      console.error(error);
    } finally {
      isHandling = false;
    }
  }

  using rl = createInterface({ input: process.stdin, output: process.stdout });

  let cancelRequested = false;
  rl.on("SIGINT", () => {
    if (!isHandling || cancelRequested) {
      rl.close();
      return;
    }
    cancelRequested = true;
    void sendMessage("/cancel").finally(() => {
      cancelRequested = false;
    });
  });

  try {
    while (true) {
      const text = await rl.question("> ");
      if (!text) {
        continue;
      }
      if (text === "/quit") {
        break;
      }
      await sendMessage(text);
    }
  } catch (e) {
    if (!(e instanceof Error && e.name === "AbortError")) {
      throw e;
    }
  }
}

// TODO:
// make exitCode non-zero for soft errors (e.g. invalid command usages) on exec.
// currently only hard errors can make exitCode = 1.
// (plan: enhance context.send interface to include status semantics)
async function runExec({ handler, text }: { handler: Handler; text: string }) {
  await handler.handle({
    sessionName: "repl",
    text,
    metadata: {
      promptMetadata: {
        timestamp: Date.now(),
      },
      cronDeliveryTarget: {
        repl: true,
      },
    },
    send: async (replyText) => {
      console.log(replyText);
    },
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
