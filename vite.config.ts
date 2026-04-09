import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    dir: "./src",
  },
  fmt: {},
  staged: {
    "*": "vp check --no-lint --fix",
  },
});
