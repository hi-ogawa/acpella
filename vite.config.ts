import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --no-lint --fix",
  },
});
