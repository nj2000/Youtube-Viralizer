import { z } from "zod";

export const SignInInputSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a complete email address (name@domain.com).")
    .max(254),
  next: z
    .string()
    .regex(/^\/[a-zA-Z0-9/_-]*$/)
    .optional(),
});
export type SignInInput = z.infer<typeof SignInInputSchema>;

export const CallbackQuerySchema = z
  .object({
    code: z.string().min(1).optional(),
    token_hash: z.string().min(1).optional(),
    type: z.enum(["magiclink", "email", "recovery", "invite"]).optional(),
    next: z
      .string()
      .regex(/^\/[a-zA-Z0-9/_-]*$/)
      .optional(),
  })
  .refine((q) => Boolean(q.code) || Boolean(q.token_hash && q.type), {
    message: "Callback requires either `code` or `token_hash`+`type`.",
  });
export type CallbackQuery = z.infer<typeof CallbackQuerySchema>;

export const CallbackReasonSchema = z.enum(["expired", "used", "invalid"]);
export type CallbackReason = z.infer<typeof CallbackReasonSchema>;
