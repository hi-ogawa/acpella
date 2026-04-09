import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    dir: "./src",
    // TODO: test real acpx codex
    // projects: [
    //   {
    //     extends: true,
    //     test: {
    //       name: "e2e",
    //     },
    //   },
    //   {
    //     extends: true,
    //     test: {
    //       name: "codex",
    //     },
    //   },
    // ],
  },
  fmt: {
    ignorePatterns: ["./refs/**"],
  },
  staged: {
    "*": "vp check --no-lint --fix",
  },
});
