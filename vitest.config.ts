import { defaultExclude, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    dir: "./src",
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
          testTimeout: 30000,
        },
      },
    ],
  },
});
