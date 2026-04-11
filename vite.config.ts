import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["./refs/**"],
  },
  lint: {
    ignorePatterns: ["./refs/**"],
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
