import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: "src/cli.ts",
    fixedExtension: false,
  },
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
