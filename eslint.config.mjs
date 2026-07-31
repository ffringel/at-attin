import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default [
  eslint.configs.recommended,

  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      // `typescript-eslint` meta-package exposes the parser directly — no need
      // for a separate @typescript-eslint/parser dependency.
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    ignores: ["**/dist"],
  },
];
