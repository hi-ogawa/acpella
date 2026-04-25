import { describe, expect, it } from "vitest";
import { parseCli } from "./cli.ts";

describe(parseCli, () => {
  it("parses global env-file option before command", () => {
    expect(
      parseCli({
        argv: ["node", "src/cli.ts", "--env-file", "./custom.env", "repl"],
        commands: ["serve", "repl", "exec"],
        defaultCommand: "serve",
      }),
    ).toEqual({
      ok: true,
      value: {
        command: "repl",
        args: [],
        envFile: "./custom.env",
      },
    });
  });

  it("fails when env-file path is missing", () => {
    expect(
      parseCli({
        argv: ["node", "src/cli.ts", "--env-file"],
        commands: ["serve", "repl", "exec"],
        defaultCommand: "serve",
      }),
    ).toEqual({
      ok: false,
      value: "Missing value for --env-file",
    });
  });
});
