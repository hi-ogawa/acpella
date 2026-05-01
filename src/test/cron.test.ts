/*
Coverage checklist:

- /cron
  - [x] bare help output
  - [x] status
  - [x] start
  - [x] stop
  - [x] add
  - [ ] add rejects missing delivery target
  - [ ] add rejects invalid args
  - [ ] add rejects invalid id
  - [ ] add rejects invalid schedule
  - [ ] add refreshes runner
  - [x] update
  - [x] list
  - [x] show
  - [ ] show unknown id
  - [x] enable
  - [ ] enable unknown id
  - [x] disable
  - [ ] disable unknown id
  - [x] delete
  - [ ] delete unknown id
  - [x] runner executes repl cron job through handler prompt
  - [x] runner renews stale session when cron prompt crosses daily boundary
  - [ ] runner records failed delivery
*/

import { expect, test, vi } from "vitest";
import { writeJsonFile } from "../utils/fs.ts";
import { advanceTimersTo, waitUntil } from "./helper.ts";
import { createHandlerTester } from "./tester.ts";

test("cron auto reloads external cron file changes", async ({ onTestFinished }) => {
  // Timeline:
  // - 07:00: runner starts with no jobs.
  // - 07:00: write file-job directly to cron.json.
  // - 07:00: watcher polls, reloads, and refreshes the scheduler.
  // - 07:02: file-job fires with hello-from-file.
  vi.useFakeTimers({
    now: Date.parse("2026-04-18T07:00:00+07:00"),
  });
  onTestFinished(() => {
    vi.useRealTimers();
  });

  const tester = await createHandlerTester();

  const session = tester.createSession("test", {
    metadata: { cronDeliveryTarget: { repl: true } },
  });
  expect(await session.request("/cron list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    No cron jobs."
  `);

  writeJsonFile(tester.config.cronFile, {
    version: 1,
    jobs: {
      "file-job": {
        id: "file-job",
        enabled: true,
        schedule: "2 * * * *",
        timezone: tester.config.timezone,
        prompt: "hello-from-file",
        target: {
          sessionName: "test",
          delivery: { repl: true },
        },
      },
    },
  });

  vi.advanceTimersByTime(1250);
  expect(await session.request("/cron list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - file-job [enabled]
      schedule: 2 * * * *
      timezone: Asia/Jakarta
      target session: test
      delivery target: repl
      next: 2026-04-18T07:02:00+07:00
      last: none"
  `);

  {
    using consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    writeJsonFile(tester.config.cronFile, {
      version: 12.34,
      jobs: {},
    });
    vi.advanceTimersByTime(1250);
    expect(consoleError.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "[cron] Failed to reload cron jobs after external cron file change: [
        {
          "code": "invalid_value",
          "values": [
            1
          ],
          "path": [
            "version"
          ],
          "message": "Invalid input: expected 1"
        }
      ]",
        ],
      ]
    `);
  }
  expect(await session.request("/cron list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - file-job [enabled]
      schedule: 2 * * * *
      timezone: Asia/Jakarta
      target session: test
      delivery target: repl
      next: 2026-04-18T07:02:00+07:00
      last: none"
  `);

  advanceTimersTo("2026-04-18T07:02:00+07:00");
  await waitUntil(() => tester.cronDeliveries.length > 0);
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`
    [
      "echo: <trigger_metadata>
    trigger: cron
    cron_id: file-job
    scheduled_at: 2026-04-18T07:02:00+07:00
    started_at: 2026-04-18T07:02:00+07:00
    timezone: Asia/Jakarta
    session_name: test
    </trigger_metadata>

    hello-from-file
    ",
    ]
  `);
});

test("cron command", async ({ onTestFinished }) => {
  // Timeline:
  // - 07:00: add test-job for every minute.
  // - 07:01: test-job fires with hello-cron.
  // - 07:01: add other-job for minute 3, disable test-job.
  // - 07:03: other-job fires with its added prompt, hello-other.
  // - 07:03: update other-job to minute 4, then update its prompt.
  // - 07:04: other-job fires with its updated prompt, hello-updated.
  vi.useFakeTimers({
    now: Date.parse("2026-04-18T07:00:00+07:00"),
  });
  onTestFinished(() => {
    vi.useRealTimers();
  });

  const tester = await createHandlerTester();

  const session = tester.createSession("test", {
    metadata: { cronDeliveryTarget: { repl: true } },
  });
  expect(await session.request("/cron status")).toMatchInlineSnapshot(`
    "[⚙️ System]
    cron runner: running
    jobs: 0
    enabled jobs: 0"
  `);
  expect(await session.request("/cron stop")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Cron runner stopped."
  `);
  expect(await session.request("/cron status")).toMatchInlineSnapshot(`
    "[⚙️ System]
    cron runner: stopped
    jobs: 0
    enabled jobs: 0"
  `);
  expect(await session.request("/cron start")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Cron runner started."
  `);
  expect(await session.request("/cron status")).toMatchInlineSnapshot(`
    "[⚙️ System]
    cron runner: running
    jobs: 0
    enabled jobs: 0"
  `);
  expect(await session.request("/cron add test-job * * * * * -- hello-cron"))
    .toMatchInlineSnapshot(`
    "[⚙️ System]
    Added cron job: test-job"
  `);
  expect(await session.request("/cron list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - test-job [enabled]
      schedule: * * * * *
      timezone: Asia/Jakarta
      target session: test
      delivery target: repl
      next: 2026-04-18T07:01:00+07:00
      last: none"
  `);
  expect(await session.request("/cron show test-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: test-job
    enabled: yes
    schedule: * * * * *
    timezone: Asia/Jakarta
    target session: test
    delivery target: repl
    next: 2026-04-18T07:01:00+07:00
    last: none
    prompt: hello-cron"
  `);
  expect(await session.request("/cron status")).toMatchInlineSnapshot(`
    "[⚙️ System]
    cron runner: running
    jobs: 1
    enabled jobs: 1"
  `);
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`[]`);

  advanceTimersTo("2026-04-18T07:01:00+07:00");
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`[]`);
  expect(await session.request("/cron show test-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: test-job
    enabled: yes
    schedule: * * * * *
    timezone: Asia/Jakarta
    target session: test
    delivery target: repl
    next: 2026-04-18T07:02:00+07:00
    last: running, scheduled 2026-04-18T07:01:00+07:00
    prompt: hello-cron"
  `);

  await waitUntil(() => tester.cronDeliveries.length > 0);
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`
    [
      "echo: <trigger_metadata>
    trigger: cron
    cron_id: test-job
    scheduled_at: 2026-04-18T07:01:00+07:00
    started_at: 2026-04-18T07:01:00+07:00
    timezone: Asia/Jakarta
    session_name: test
    </trigger_metadata>

    hello-cron
    ",
    ]
  `);
  expect(await session.request("/cron show test-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: test-job
    enabled: yes
    schedule: * * * * *
    timezone: Asia/Jakarta
    target session: test
    delivery target: repl
    next: 2026-04-18T07:02:00+07:00
    last: succeeded, scheduled 2026-04-18T07:01:00+07:00, finished 2026-04-18T07:01:00+07:00
    prompt: hello-cron"
  `);
  tester.cronDeliveries.length = 0;

  expect(await session.request("/cron add other-job 3 * * * * -- hello-other"))
    .toMatchInlineSnapshot(`
    "[⚙️ System]
    Added cron job: other-job"
  `);
  expect(await session.request("/cron disable test-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Disabled cron job: test-job"
  `);
  expect(await session.request("/cron list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - test-job [disabled]
      schedule: * * * * *
      timezone: Asia/Jakarta
      target session: test
      delivery target: repl
      next: none
      last: succeeded, scheduled 2026-04-18T07:01:00+07:00, finished 2026-04-18T07:01:00+07:00

    - other-job [enabled]
      schedule: 3 * * * *
      timezone: Asia/Jakarta
      target session: test
      delivery target: repl
      next: 2026-04-18T07:03:00+07:00
      last: none"
  `);

  advanceTimersTo("2026-04-18T07:03:00+07:00");
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`[]`);
  expect(await session.request("/cron show other-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: other-job
    enabled: yes
    schedule: 3 * * * *
    timezone: Asia/Jakarta
    target session: test
    delivery target: repl
    next: 2026-04-18T08:03:00+07:00
    last: running, scheduled 2026-04-18T07:03:00+07:00
    prompt: hello-other"
  `);

  await waitUntil(() => tester.cronDeliveries.length > 0);
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`
    [
      "echo: <trigger_metadata>
    trigger: cron
    cron_id: other-job
    scheduled_at: 2026-04-18T07:03:00+07:00
    started_at: 2026-04-18T07:03:00+07:00
    timezone: Asia/Jakarta
    session_name: test
    </trigger_metadata>

    hello-other
    ",
    ]
  `);
  tester.cronDeliveries.length = 0;

  expect(await session.request("/cron update other-job 4 * * * *")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Updated cron job: other-job"
  `);
  expect(await session.request("/cron show other-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: other-job
    enabled: yes
    schedule: 4 * * * *
    timezone: Asia/Jakarta
    target session: test
    delivery target: repl
    next: 2026-04-18T07:04:00+07:00
    last: succeeded, scheduled 2026-04-18T07:03:00+07:00, finished 2026-04-18T07:03:00+07:00
    prompt: hello-other"
  `);
  expect(await session.request("/cron update other-job 4 * * * * -- hello-updated"))
    .toMatchInlineSnapshot(`
    "[⚙️ System]
    Updated cron job: other-job"
  `);

  advanceTimersTo("2026-04-18T07:04:00+07:00");
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`[]`);
  expect(await session.request("/cron show other-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: other-job
    enabled: yes
    schedule: 4 * * * *
    timezone: Asia/Jakarta
    target session: test
    delivery target: repl
    next: 2026-04-18T08:04:00+07:00
    last: running, scheduled 2026-04-18T07:04:00+07:00
    prompt: hello-updated"
  `);

  await waitUntil(() => tester.cronDeliveries.length > 0);
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`
    [
      "echo: <trigger_metadata>
    trigger: cron
    cron_id: other-job
    scheduled_at: 2026-04-18T07:04:00+07:00
    started_at: 2026-04-18T07:04:00+07:00
    timezone: Asia/Jakarta
    session_name: test
    </trigger_metadata>

    hello-updated
    ",
    ]
  `);
  expect(await session.request("/cron list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - test-job [disabled]
      schedule: * * * * *
      timezone: Asia/Jakarta
      target session: test
      delivery target: repl
      next: none
      last: succeeded, scheduled 2026-04-18T07:01:00+07:00, finished 2026-04-18T07:01:00+07:00

    - other-job [enabled]
      schedule: 4 * * * *
      timezone: Asia/Jakarta
      target session: test
      delivery target: repl
      next: 2026-04-18T08:04:00+07:00
      last: succeeded, scheduled 2026-04-18T07:04:00+07:00, finished 2026-04-18T07:04:00+07:00"
  `);

  expect(await session.request("/cron enable test-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Enabled cron job: test-job"
  `);
  expect(await session.request("/cron status")).toMatchInlineSnapshot(`
    "[⚙️ System]
    cron runner: running
    jobs: 2
    enabled jobs: 2"
  `);
  expect(await session.request("/cron delete test-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Deleted cron job: test-job"
  `);
  expect(await session.request("/cron list")).toMatchInlineSnapshot(`
    "[⚙️ System]
    - other-job [enabled]
      schedule: 4 * * * *
      timezone: Asia/Jakarta
      target session: test
      delivery target: repl
      next: 2026-04-18T08:04:00+07:00
      last: succeeded, scheduled 2026-04-18T07:04:00+07:00, finished 2026-04-18T07:04:00+07:00"
  `);
  expect(await session.request("/cron status")).toMatchInlineSnapshot(`
    "[⚙️ System]
    cron runner: running
    jobs: 1
    enabled jobs: 1"
  `);
});

test("cron error delivery", async ({ onTestFinished }) => {
  // Timeline:
  // - 07:00: add test-job for every minute with a failing prompt.
  // - 07:01: test-job starts and records a running state.
  // - 07:01: prompt fails, run records failure, delivery receives an error notice.
  vi.useFakeTimers({
    now: Date.parse("2026-04-18T07:00:00+07:00"),
  });
  onTestFinished(() => {
    vi.useRealTimers();
  });

  const tester = await createHandlerTester();

  const session = tester.createSession("test", {
    metadata: { cronDeliveryTarget: { repl: true } },
  });
  expect(await session.request("/cron add test-job * * * * * -- __throw_error__"))
    .toMatchInlineSnapshot(`
    "[⚙️ System]
    Added cron job: test-job"
  `);
  expect(await session.request("/cron show test-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: test-job
    enabled: yes
    schedule: * * * * *
    timezone: Asia/Jakarta
    target session: test
    delivery target: repl
    next: 2026-04-18T07:01:00+07:00
    last: none
    prompt: __throw_error__"
  `);
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`[]`);

  advanceTimersTo("2026-04-18T07:01:00+07:00");
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`[]`);
  expect(await session.request("/cron show test-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: test-job
    enabled: yes
    schedule: * * * * *
    timezone: Asia/Jakarta
    target session: test
    delivery target: repl
    next: 2026-04-18T07:02:00+07:00
    last: running, scheduled 2026-04-18T07:01:00+07:00
    prompt: __throw_error__"
  `);

  await waitUntil(() => tester.cronDeliveries.length > 0);
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`
    [
      "[cron] test-job failed

    scheduled_at: 2026-04-18T07:01:00+07:00
    started_at: 2026-04-18T07:01:00+07:00
    timezone: Asia/Jakarta
    session_name: test

    Error:
    Internal error
    ",
    ]
  `);
  expect(await session.request("/cron show test-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: test-job
    enabled: yes
    schedule: * * * * *
    timezone: Asia/Jakarta
    target session: test
    delivery target: repl
    next: 2026-04-18T07:02:00+07:00
    last: failed, scheduled 2026-04-18T07:01:00+07:00, finished 2026-04-18T07:01:00+07:00, error: Internal error
    prompt: __throw_error__"
  `);
});

test("cron suppresses NO_REPLY delivery", async ({ onTestFinished }) => {
  // Timeline:
  // - 07:00: add test-job for every minute with a raw NO_REPLY response.
  // - 07:01: test-job fires, run succeeds, and delivery is suppressed.
  vi.useFakeTimers({
    now: Date.parse("2026-04-18T07:00:00+07:00"),
  });
  onTestFinished(() => {
    vi.useRealTimers();
  });

  const tester = await createHandlerTester();

  const session = tester.createSession("test", {
    metadata: { cronDeliveryTarget: { repl: true } },
  });
  expect(await session.request("/cron add test-job * * * * * -- __raw:NO_REPLY"))
    .toMatchInlineSnapshot(`
    "[⚙️ System]
    Added cron job: test-job"
  `);

  advanceTimersTo("2026-04-18T07:01:00+07:00");
  await waitUntil(async () => {
    const output = await session.request("/cron show test-job");
    return output.includes("last: succeeded");
  });
  expect(await session.request("/cron show test-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: test-job
    enabled: yes
    schedule: * * * * *
    timezone: Asia/Jakarta
    target session: test
    delivery target: repl
    next: 2026-04-18T07:02:00+07:00
    last: succeeded, scheduled 2026-04-18T07:01:00+07:00, finished 2026-04-18T07:01:00+07:00
    prompt: __raw:NO_REPLY"
  `);
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`[]`);
});

test("cron with session name", async ({ onTestFinished }) => {
  // Sequence:
  // - Create tg-12345 and tg-12345-678 sessions so --session can target known sessions.
  // - Add tg-job with --session tg-12345 and verify chat-only Telegram delivery.
  // - Update tg-job with --session tg-12345-678 and verify thread Telegram delivery.
  // - Add tg-job2 with --session tg-12345-678 and verify thread Telegram delivery.
  // - Add tg-job3 with a multi-word prompt and verify prompt parsing is preserved.
  vi.useFakeTimers({
    now: Date.parse("2026-04-18T07:00:00+07:00"),
  });
  onTestFinished(() => {
    vi.useRealTimers();
  });

  const tester = await createHandlerTester();

  // setup deliver target sessions
  const targetSession1 = tester.createSession("tg-12345");
  await targetSession1.request("hello");
  const targetSession2 = tester.createSession("tg-12345-678");
  await targetSession2.request("hello");

  // setup cron from repl
  const session = tester.createSession("test", {
    metadata: { cronDeliveryTarget: { repl: true } },
  });

  // With only chatId
  expect(await session.request("/cron add tg-job * * * * * --session tg-12345 -- hello-cron"))
    .toMatchInlineSnapshot(`
    "[⚙️ System]
    Added cron job: tg-job"
  `);
  expect(await session.request("/cron show tg-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: tg-job
    enabled: yes
    schedule: * * * * *
    timezone: Asia/Jakarta
    target session: tg-12345
    delivery target: telegram:12345
    next: 2026-04-18T07:01:00+07:00
    last: none
    prompt: hello-cron"
  `);
  expect(
    await session.request("/cron update tg-job 2 * * * * --session tg-12345-678 -- hello-updated"),
  ).toMatchInlineSnapshot(`
    "[⚙️ System]
    Updated cron job: tg-job"
  `);
  expect(await session.request("/cron show tg-job")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: tg-job
    enabled: yes
    schedule: 2 * * * *
    timezone: Asia/Jakarta
    target session: tg-12345-678
    delivery target: telegram:12345/678
    next: 2026-04-18T07:02:00+07:00
    last: none
    prompt: hello-updated"
  `);

  // With chatId and messageThreadId
  expect(
    await session.request("/cron add tg-job2 * * * * * --session tg-12345-678 -- hello-thread"),
  ).toMatchInlineSnapshot(`
    "[⚙️ System]
    Added cron job: tg-job2"
  `);
  expect(await session.request("/cron show tg-job2")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: tg-job2
    enabled: yes
    schedule: * * * * *
    timezone: Asia/Jakarta
    target session: tg-12345-678
    delivery target: telegram:12345/678
    next: 2026-04-18T07:01:00+07:00
    last: none
    prompt: hello-thread"
  `);

  // Multi-word prompt with sessionName
  expect(await session.request("/cron add tg-job3 * * * * * --session tg-12345 -- hello world"))
    .toMatchInlineSnapshot(`
    "[⚙️ System]
    Added cron job: tg-job3"
  `);
  expect(await session.request("/cron show tg-job3")).toMatchInlineSnapshot(`
    "[⚙️ System]
    id: tg-job3
    enabled: yes
    schedule: * * * * *
    timezone: Asia/Jakarta
    target session: tg-12345
    delivery target: telegram:12345
    next: 2026-04-18T07:01:00+07:00
    last: none
    prompt: hello world"
  `);
});

test("cron runner renews stale session after daily boundary", async ({ onTestFinished }) => {
  // Timeline:
  // - 03:30: enable daily renewal at 04:00 and create __testSession1.
  // - 03:30: add renew-job for 04:30.
  // - 04:30: renew-job crosses the boundary and uses __testSession2.
  vi.useFakeTimers({
    now: Date.parse("2026-04-18T03:30:00+07:00"),
  });
  onTestFinished(() => {
    vi.useRealTimers();
  });

  const tester = await createHandlerTester();

  const session = tester.createSession("test", {
    metadata: { cronDeliveryTarget: { repl: true } },
  });

  expect(await session.request("/session renew daily:4")).toMatchInlineSnapshot(`
    "[⚙️ System]
    Session renewal: daily at 04:00 Asia/Jakarta"
  `);
  expect(await session.request("__session")).toMatchInlineSnapshot(`"session: __testSession1"`);

  expect(
    await session.request(
      "/cron add renew-job 30 4 * * * -- __include_session__ cron-after-boundary",
    ),
  ).toMatchInlineSnapshot(`
    "[⚙️ System]
    Added cron job: renew-job"
  `);

  advanceTimersTo("2026-04-18T04:30:00+07:00");

  await waitUntil(() => tester.cronDeliveries.length > 0);
  expect(tester.cronDeliveries).toMatchInlineSnapshot(`
    [
      "session: __testSession2
    <trigger_metadata>
    trigger: cron
    cron_id: renew-job
    scheduled_at: 2026-04-18T04:30:00+07:00
    started_at: 2026-04-18T04:30:00+07:00
    timezone: Asia/Jakarta
    session_name: test
    </trigger_metadata>

     cron-after-boundary",
    ]
  `);
});
