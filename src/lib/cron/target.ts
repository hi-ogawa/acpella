import { parseDiscordSessionName } from "../discord/utils.ts";
import { parseTelegramSessionName } from "../telegram/utils.ts";
import type { CronDeliveryTarget } from "./store.ts";

export function parseSessionCronDeliveryTarget(
  sessionName: string,
): CronDeliveryTarget | undefined {
  const telegram = parseTelegramSessionName(sessionName);
  if (telegram) {
    return { telegram };
  }
  const discord = parseDiscordSessionName(sessionName);
  if (discord) {
    return { discord };
  }
}
