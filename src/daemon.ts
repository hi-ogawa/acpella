import { AGENT, CWD } from "./config.ts";
import { createBot } from "./telegram.ts";

const bot = createBot();
console.log(`Starting daemon (agent: ${AGENT}, cwd: ${CWD})`);
bot.start();
