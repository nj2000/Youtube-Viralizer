import { z } from "zod";

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  YOUTUBE_API_KEY: z.string().min(1, "YOUTUBE_API_KEY is required"),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_ANON_KEY: z.string().min(1, "SUPABASE_ANON_KEY is required"),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY is required"),
  SITE_URL: z.string().url("SITE_URL must be a valid URL"),
  // Daily Anthropic spend cap (USD) — guards the Opus 4.7 script stage.
  ANTHROPIC_DAILY_BUDGET_USD: z.coerce.number().positive().default(50),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(
    `Invalid environment configuration. Fix the following issues:\n${issues}`,
  );
}

export const env = parsed.data;
export type Env = z.infer<typeof envSchema>;
