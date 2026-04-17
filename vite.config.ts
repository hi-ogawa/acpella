import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["fixtures/telegram-html/**"],
    sortImports: {
      newlinesBetween: false,
    },
  },
  lint: {
    rules: {
      curly: "error",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  staged: {
    "*": "vp check --fix",
  },
});
