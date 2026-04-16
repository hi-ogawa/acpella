import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    dir: "./src",
    coverage: {
      provider: "v8",
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
