import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginReact from "eslint-plugin-react";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"]},
  {languageOptions: { globals: globals.browser }},
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.jsx", "**/*.tsx"],
    plugins: {
      react: pluginReact,
    },
    rules: {
      ...pluginReact.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
      rules: {
         "@typescript-eslint/no-explicit-any": "warn",
         "@typescript-eslint/ban-ts-comment": "off",
         "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }]
      }
  },
  eslintConfigPrettier,
  {
      ignores: ["dist/", "node_modules/"]
  }
);
