import { beforeEach, expect, test, vi } from "vitest";
import { execFileAsync } from "../utils/process.ts";
import { getVersion } from "./version.ts";

vi.mock("../utils/process.ts", () => ({
  execFileAsync: vi.fn(),
}));

const execFileAsyncMock = vi.mocked(execFileAsync);

function execResult(stdout: string): ReturnType<typeof execFileAsync> {
  return Promise.resolve({ stdout, stderr: "" }) as ReturnType<typeof execFileAsync>;
}

beforeEach(() => {
  execFileAsyncMock.mockReset();
});

test("reports package version with git metadata", async () => {
  execFileAsyncMock.mockImplementation((_file, args) => {
    switch ((args as string[]).join(" ")) {
      case "branch --show-current": {
        return execResult("main\n");
      }
      case "rev-parse --short HEAD": {
        return execResult("c060ea1\n");
      }
      case "status --porcelain=v1": {
        return execResult("");
      }
      default: {
        throw new Error(`Unexpected git args: ${String(args)}`);
      }
    }
  });

  await expect(getVersion({ cwd: "/repo" })).resolves.toBe("package 0.0.0 (git c060ea1 main)");
});

test("reports dirty git metadata", async () => {
  execFileAsyncMock.mockImplementation((_file, args) => {
    switch ((args as string[]).join(" ")) {
      case "branch --show-current": {
        return execResult("main\n");
      }
      case "rev-parse --short HEAD": {
        return execResult("c060ea1\n");
      }
      case "status --porcelain=v1": {
        return execResult(" M src/lib/version.ts\n");
      }
      default: {
        throw new Error(`Unexpected git args: ${String(args)}`);
      }
    }
  });

  await expect(getVersion({ cwd: "/repo" })).resolves.toBe(
    "package 0.0.0 (git c060ea1 main dirty)",
  );
});

test("reports only package version when git metadata is unavailable", async () => {
  execFileAsyncMock.mockRejectedValue(new Error("not a git checkout"));

  await expect(getVersion({ cwd: "/package" })).resolves.toBe("package 0.0.0");
});
