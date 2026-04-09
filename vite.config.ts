import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["./refs/**"],
  },
  staged: {
    "*": "vp check --no-lint --fix",
  },
});
