import { expect, test } from "vitest";
import { createHandlerTester } from "./tester.ts";

test("shell command succeeds", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");

  expect(await session.request('/shell --timeout=2 node -e "console.log(process.cwd())"'))
    .toMatchInlineSnapshot(`
      "[⚙️ System]
      $ node -e "console.log(process.cwd())"
      exit: 0

      stdout:
      <home>"
    `);
});

test("shell command fails", async () => {
  const tester = await createHandlerTester();
  const session = tester.createSession("test");

  expect(
    await session.request(
      `/shell node -e "process.stdout.write('out');process.stderr.write('err');process.exit(7)"`,
    ),
  ).toMatchInlineSnapshot(`
    "[⚙️ System]
    $ node -e "process.stdout.write('out');process.stderr.write('err');process.exit(7)"
    exit: 7

    stdout:
    out

    stderr:
    err"
  `);
});
