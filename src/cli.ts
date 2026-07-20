import "temporal-polyfill/global";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { loadConfig, type AppConfig } from "./config.ts";
import { createHandler, type Handler, type HandlerExtraCommands } from "./handler.ts";
import { parseCli } from "./lib/cli.ts";
import { CronRunner, type CronDeliveryHandler } from "./lib/cron/runner.ts";
import { CronStore } from "./lib/cron/store.ts";
import { defineDiscordCommands } from "./lib/discord/channel.ts";
import { serveDiscord } from "./lib/discord/service.ts";
import { serveTelegram } from "./lib/telegram/service.ts";
import { getVersion } from "./lib/version.ts";

const ACPELLA_SKILL_PATH = path.resolve(import.meta.dirname, "../skills/acpella/SKILL.md");

const CLI_HELP = `\
Usage: acpella <command>

Commands:
  serve             Run bot service.
  repl              Run local in-process REPL.
  exec <message...> Run one local message, then exit.

Options:
  --env-file=<path> Use this env file for config resolution.
  -h, --help        Show this help.

Full guide:
  ${ACPELLA_SKILL_PATH}
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
  });

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

  const config = loadConfig({
    envFile: cli.envFile,
  });
  const version = await getVersion({ cwd: path.join(import.meta.dirname, "..") });
  const cronStore = new CronStore({
    cronFile: config.cronFile,
    cronStateFile: config.cronStateFile,
  });

  const cronDeliveryHandlers = new Set<CronDeliveryHandler>();
  function registerCronDeliveryHandler(handler: CronDeliveryHandler): void {
    cronDeliveryHandlers.add(handler);
  }

  const cronRunner = new CronRunner({
    store: cronStore,
    agent: {
      prompt: (...args) => handler.prompt(...args),
    },
    delivery: {
      send: async ({ target, text }) => {
        for (const handler of cronDeliveryHandlers) {
          await handler({ target, text });
        }
      },
    },
  });

  const extraCommands: HandlerExtraCommands = {};
  if (config.discord.token) {
    extraCommands.discord = defineDiscordCommands({
      token: config.discord.token,
      allowedGuildIds: config.discord.allowedGuildIds,
      allowedChannelIds: config.discord.allowedChannelIds,
    });
  }

  const handler = await createHandler(config, {
    version,
    onServiceExit: () => {
      setImmediate(() => {
        console.log("Exiting by /service exit");
        process.exit(0);
      });
    },
    cronStore,
    // TODO(#311): break handler <-> cronRunner cycle
    getCronRunner: () => cronRunner,
    extraCommands,
  });
  handler.start();

  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => handler.stop());
  cleanup.defer(() => cronRunner.stop());

  if (cli.command === "repl") {
    await startRepl({
      config,
      handler,
      version,
      registerCronDeliveryHandler,
    });
    return;
  }

  if (cli.command === "exec") {
    await runExec({ handler, text: cli.args.join(" ") });
    return;
  }

  const channelNames: string[] = [];
  const channelTasks: Promise<void>[] = [];
  if (config.telegram.token) {
    channelNames.push("telegram");
    const botRunner = await serveTelegram({
      config,
      handler,
      registerCronDeliveryHandler,
    });
    cleanup.defer(() => botRunner.stop());
    channelTasks.push(botRunner.task()!);
  }
  if (config.discord.token) {
    channelNames.push("discord");
    const client = await serveDiscord({
      config,
      handler,
      registerCronDeliveryHandler,
    });
    cleanup.defer(() => client.destroy());
    channelTasks.push(new Promise<never>(() => {}));
  }
  if (channelTasks.length === 0) {
    throw new Error("No service channels configured. Configure Telegram or Discord credentials.");
  }
  console.log(
    `Starting service (version: ${version}, home: ${config.home}, channels: ${channelNames.join(", ")})`,
  );
  cronRunner.start();
  await Promise.all(channelTasks);
}

async function startRepl({
  config,
  handler,
  registerCronDeliveryHandler,
  version,
}: {
  config: AppConfig;
  handler: Handler;
  registerCronDeliveryHandler: (handler: CronDeliveryHandler) => void;
  version: string;
}) {
  console.log(`Starting repl (version: ${version}, home: ${config.home})`);
  registerCronDeliveryHandler(async ({ target, text }) => {
    if (!target.repl) {
      return;
    }
    console.log("[cron] repl delivery:", text);
    console.log(text);
  });

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
