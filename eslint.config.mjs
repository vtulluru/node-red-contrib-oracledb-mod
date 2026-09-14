import { createRequire } from "module";
const req = createRequire(import.meta.url);
const Module = req("module");
const originalRequire = Module.prototype.require;

// TypeScript 7.0 uses a native Go binary for compilation (tsc) and defers the JS AST API to 7.1.
// Redirect typescript-eslint AST queries to @typescript/typescript6:
Module.prototype.require = function (id) {
  if (id === "typescript") {
    return originalRequire.call(this, "@typescript/typescript6");
  }
  return originalRequire.apply(this, arguments);
};

const js = req("@eslint/js");
const tsPlugin = req("@typescript-eslint/eslint-plugin");
const tsParser = req("@typescript-eslint/parser");

export default [
  js.configs.recommended,
  {
    files: ["src/nodejs/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "semi": ["error", "always"],
      "quotes": ["error", "double"],
      "no-undef": "off",
      "no-useless-assignment": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-var-requires": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      "no-prototype-builtins": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_|^err$" }],
      "@typescript-eslint/no-this-alias": "off",
    },
  },
  {
    ignores: [
      "coverage/**",
      "transpiled/**",
      "lib/**",
      "node_modules/**"
    ]
  }
];
