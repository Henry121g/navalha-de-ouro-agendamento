import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv, serverEnv } from "@/lib/env";
import { processOutboxRow, type OutboxRow } from "@/lib/outbox";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * Processa a fila de e-mails. Chamada a cada 5 min pelo pg_cron (pg_net) do Supabase
 * — o cron do plano Hobby da Vercel só roda 1x/dia. Protegida por CRON_SECRET.
 */
export async function GET(request: NextRequest) {
  const env = serverEnv();
  if (!authorized(request, env.CRON_SECRET)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_outbox", { p_limit: 20 });
  if (error) return NextResponse.json({ error: "falha ao ler a fila" }, { status: 500 });

  const results = [];
  for (const row of (data ?? []) as OutboxRow[]) {
    results.push(
      await processOutboxRow(row, {
        admin,
        siteUrl: publicEnv.NEXT_PUBLIC_SITE_URL,
        resendApiKey: env.RESEND_API_KEY,
        from: env.EMAIL_FROM,
        testRecipient: env.EMAIL_TEST_RECIPIENT,
      }),
    );
  }
  return NextResponse.json({ processed: results.length, results });
}
