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
      "no-unused-vars": "off",
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
