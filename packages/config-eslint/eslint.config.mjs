import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const repoIgnores = [
  "**/dist/**",
  "**/node_modules/**",
  ".turbo/**",
  "**/*.tsbuildinfo",
  "coverage/**"
];

const restrictedCrossWorkspaceImports = [
  "../apps/*",
  "../packages/*",
  "../../apps/*",
  "../../packages/*",
  "../../../apps/*",
  "../../../packages/*"
];

export default tseslint.config(
  {
    ignores: repoIgnores
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node
      }
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: restrictedCrossWorkspaceImports
        }
      ]
    }
  },
  {
    files: ["apps/web/**/*.{ts,mts,cts}"],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    }
  }
);
