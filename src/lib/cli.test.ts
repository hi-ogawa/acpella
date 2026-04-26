import { describe, expect, it } from "vitest";
import { parseCli } from "./cli.ts";

describe(parseCli, () => {
  it("parses global env-file option before command", () => {
    expect(
      parseCli({
        argv: ["--env-file", "./custom.env", "repl"],
        commands: ["serve", "repl", "exec"],
        defaultCommand: "serve",
      }),
    ).toMatchInlineSnapshot(`
      {
        "args": [],
        "command": "repl",
        "envFile": "./custom.env",
      }
    `);
  });

  it("fails when env-file path is missing", () => {
    expect(() =>
      parseCli({
        argv: ["--env-file"],
        commands: ["serve", "repl", "exec"],
        defaultCommand: "serve",
      }),
    ).toThrowErrorMatchingInlineSnapshot(`[Error: Missing value for --env-file]`);
  });
});
