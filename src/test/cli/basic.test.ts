import { expect, test } from "vitest";
import { sanitizeCliError, sanitizeOutput, useCli } from "./helper.ts";

test("help", async () => {
  const cli = useCli();
  const result = await cli.cli("--help");
  expect(sanitizeOutput(result.stderr)).toMatchInlineSnapshot(`""`);
  expect(sanitizeOutput(result.stdout)).toMatchInlineSnapshot(`
    "Usage: acpella <command>

    Commands:
      serve             Run bot service.
      repl              Run local in-process REPL.
      exec <message...> Run one local message, then exit.

    Options:
      --env-file=<path> Use this env file for config resolution.
      -h, --help        Show this help.

    Full guide:
      <root>/skills/acpella/SKILL.md

    "
  `);
});

test("unknown command error", async () => {
  const cli = useCli();
  await expect(cli.cli("yay").catch(sanitizeCliError)).resolves.toThrowErrorMatchingInlineSnapshot(`
    "Command failed: pnpm -s dev yay
    Error: Unknown command: yay"
  `);
});

test("missing command error", async () => {
  const cli = useCli();
  await expect(cli.cli().catch(sanitizeCliError)).resolves.toThrowErrorMatchingInlineSnapshot(`
    "Command failed: pnpm -s dev
    Error: Missing command"
  `);
});

test("unexpected command arguments error", async () => {
  const cli = useCli();
  await expect(cli.cli("serve", "--channel=discord").catch(sanitizeCliError)).resolves
    .toThrowErrorMatchingInlineSnapshot(`
      "Command failed: pnpm -s dev serve --channel=discord
      Error: Unexpected arguments for serve: --channel=discord

      Usage: acpella <command>

      Commands:
        serve             Run bot service.
        repl              Run local in-process REPL.
        exec <message...> Run one local message, then exit.

      Options:
        --env-file=<path> Use this env file for config resolution.
        -h, --help        Show this help.

      Full guide:
        <root>/skills/acpella/SKILL.md"
    `);
});

test("serve fails without channel env", async ({ onTestFinished }) => {
  const cli = useCli();
  expect(process.env.ACPELLA_TELEGRAM_BOT_TOKEN).toBe(undefined);
  await expect(cli.cli("serve").catch(sanitizeCliError)).resolves
    .toThrowErrorMatchingInlineSnapshot(`
    "Command failed: pnpm -s dev serve
    Error: No service channels configured. Configure Telegram or Discord credentials."
  `);
  process.env.ACPELLA_TELEGRAM_BOT_TOKEN = "ok";
  onTestFinished(() => {
    delete process.env.ACPELLA_TELEGRAM_BOT_TOKEN;
  });
  expect(process.env.ACPELLA_TELEGRAM_ALLOWED_USER_IDS).toBe(undefined);
  await expect(cli.cli("serve").catch(sanitizeCliError)).resolves
    .toThrowErrorMatchingInlineSnapshot(`
      "Command failed: pnpm -s dev serve
      Error: ACPELLA_TELEGRAM_ALLOWED_USER_IDS must be non-empty"
    `);
});

test("serve fails with partial discord env", async ({ onTestFinished }) => {
  const cli = useCli();
  expect(process.env.ACPELLA_DISCORD_BOT_TOKEN).toBe(undefined);
  await expect(cli.cli("serve").catch(sanitizeCliError)).resolves
    .toThrowErrorMatchingInlineSnapshot(`
    "Command failed: pnpm -s dev serve
    Error: No service channels configured. Configure Telegram or Discord credentials."
  `);
  process.env.ACPELLA_DISCORD_BOT_TOKEN = "ok";
  onTestFinished(() => {
    delete process.env.ACPELLA_DISCORD_BOT_TOKEN;
  });
  expect(process.env.ACPELLA_DISCORD_ALLOWED_GUILD_IDS).toBe(undefined);
  await expect(cli.cli("serve").catch(sanitizeCliError)).resolves
    .toThrowErrorMatchingInlineSnapshot(`
      "Command failed: pnpm -s dev serve
      Error: ACPELLA_DISCORD_ALLOWED_GUILD_IDS must be non-empty"
    `);
});
