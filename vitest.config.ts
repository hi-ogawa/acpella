import { defaultExclude, defineConfig } from "vitest/config";

const isCI = process.env.CI === "true";
const isGitHubActions = process.env.GITHUB_ACTIONS === "true";

export default defineConfig({
  test: {
    dir: "./src",
    reporters: [
      "default",
      ...(isGitHubActions ? ["github-actions"] : []),
      ...(isCI ? [["html", { outputFile: ".vitest/html/index.html" }] as any] : []),
    ],
    coverage: {
      enabled: isCI,
      provider: "v8",
      reportsDirectory: ".vitest/coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/test/**"],
    },
    setupFiles: ["./src/test/setup.ts"],
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
