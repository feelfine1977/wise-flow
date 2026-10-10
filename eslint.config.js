import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "storybook-static/**", "node_modules/**", "test-results/**", "fixtures/*.json"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "stories/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    },
  },
  {
    // Each spread element is one call argument; engines limit their number, so a graph-sized array overflows the stack.
    // Only array literals without spreads of their own may be spread into Math.max and Math.min.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name=/^(max|min)$/] > SpreadElement.arguments:matches([argument.type!='ArrayExpression'], :has(ArrayExpression > SpreadElement))",
          message: "Spreading an array into Math.max or Math.min fails on large inputs; reduce over it in a loop.",
        },
        {
          selector: "CallExpression[callee.property.name='apply'][callee.object.object.name='Math'][callee.object.property.name=/^(max|min)$/]",
          message: "Applying Math.max or Math.min to an array fails on large inputs; reduce over it in a loop.",
        },
      ],
    },
  },
  {
    files: ["stories/**/*.tsx"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
);
