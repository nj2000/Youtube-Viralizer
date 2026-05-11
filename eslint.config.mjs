import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["lib/anthropic/**", "lib/youtube/**", "tests/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@anthropic-ai/sdk",
              message:
                "Import from `@/lib/anthropic` instead. Direct SDK imports are forbidden outside `lib/anthropic/**` (CRIT-2/CRIT-3 enforcement).",
            },
            {
              name: "googleapis",
              message:
                "Import from `@/lib/youtube` instead. Direct googleapis imports are forbidden outside `lib/youtube/**` (CRIT-1 enforcement).",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
