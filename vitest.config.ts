import { defaultExclude, defineConfig, type TestUserConfig } from "vitest/config";

const isCI = process.env.CI === "true";
const isGitHubActions = process.env.GITHUB_ACTIONS === "true";
type ReporterEntry = Extract<NonNullable<TestUserConfig["reporters"]>, unknown[]>[number];
const htmlReporter = ["html", { outputFile: ".vitest/html/index.html" }] satisfies ReporterEntry;
const reporters: TestUserConfig["reporters"] = [
  "default",
  ...(isGitHubActions ? (["github-actions"] as const) : []),
  ...(isCI ? [htmlReporter] : []),
];

export default defineConfig({
  test: {
    dir: "./src",
    reporters,
    coverage: {
      provider: "v8",
      reportsDirectory: ".vitest/coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/test/**", "src/e2e/**"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          exclude: [...defaultExclude, "**/codex/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "codex",
          include: ["**/codex/**/*.test.ts"],
        },
      },
    ],
  },
});
