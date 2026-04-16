import { defaultExclude, defineConfig } from "vitest/config";

const isCI = process.env.CI === "true";
const isGitHubActions = process.env.GITHUB_ACTIONS === "true";

export default defineConfig({
  test: {
    dir: "./src",
    reporters: isCI
      ? [
          "default",
          ...(isGitHubActions ? ["github-actions"] : []),
          ["html", { outputFile: ".vitest/html/index.html" }],
        ]
      : ["default"],
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
