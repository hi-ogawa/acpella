import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    dir: "./src",
  },
  fmt: {
    ignorePatterns: ["./refs/**"],
  },
  staged: {
    "*": "vp check --no-lint --fix",
  },
});
