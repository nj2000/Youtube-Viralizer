import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

const serverOnlyStub = fileURLToPath(
  new URL("./tests/server-only.ts", import.meta.url),
);

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: false,
    alias: [{ find: /^server-only$/, replacement: serverOnlyStub }],
  },
});
