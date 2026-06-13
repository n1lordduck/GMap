import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
      "eqeqeq": "error",
      "no-var": "error",
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["public/js/**/*.js"],
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-undef": "error",
      "eqeqeq": "error",
      "no-var": "error",
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
      },
    },
  },
];