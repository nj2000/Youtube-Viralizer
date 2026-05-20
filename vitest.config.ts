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
    // Dummy values so `lib/env.ts` Zod validation passes when a test
    // transitively imports modules that read env (e.g. the orchestrator now
    // eagerly loads the stage-handler barrel → the Anthropic client). No test
    // makes a real network call — the SDK is constructed but never invoked.
    env: {
      ANTHROPIC_API_KEY: "test-anthropic-key",
      YOUTUBE_API_KEY: "test-youtube-key",
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      RESEND_API_KEY: "test-resend-key",
      SITE_URL: "https://test.local",
    },
  },
});
