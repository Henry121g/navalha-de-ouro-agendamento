import { z } from "zod";

// Variáveis públicas (expostas ao navegador). Valores ausentes falham cedo, com mensagem clara.
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ message: "NEXT_PUBLIC_SUPABASE_URL ausente ou inválida" }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20, "NEXT_PUBLIC_SUPABASE_ANON_KEY ausente"),
  NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
});

export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
});

/** Variáveis exclusivas do servidor. Chame apenas em código de servidor. */
export function serverEnv() {
  return z
    .object({
      SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, "SUPABASE_SERVICE_ROLE_KEY ausente"),
      CRON_SECRET: z.string().min(16, "CRON_SECRET deve ter ao menos 16 caracteres"),
      RESEND_API_KEY: z.string().optional(),
      EMAIL_FROM: z.string().default("Barbearia Demo <onboarding@resend.dev>"),
      // Sem domínio verificado, o Resend só entrega ao e-mail do dono da conta.
      EMAIL_TEST_RECIPIENT: z.email().optional(),
    })
    .parse({
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      CRON_SECRET: process.env.CRON_SECRET,
      RESEND_API_KEY: process.env.RESEND_API_KEY || undefined,
      EMAIL_FROM: process.env.EMAIL_FROM || undefined,
      EMAIL_TEST_RECIPIENT: process.env.EMAIL_TEST_RECIPIENT || undefined,
    });
}

export const DB_SCHEMA = "barbearia" as const;
