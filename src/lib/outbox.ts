import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEmail, type EmailData, type EmailKind } from "./email-templates";

export interface OutboxRow {
  id: number;
  booking_id: string;
  kind: EmailKind;
}

interface BookingDetails {
  status: string;
  starts_at: string;
  price_cents: number;
  client_id: string;
  services: { name: string };
  professionals: { display_name: string };
  profiles: { full_name: string };
  shops: { timezone: string };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cliente sem tipos gerados, schema "barbearia"
type AnyClient = SupabaseClient<any, any, any>;

export interface SendResult {
  id: number;
  status: "sent" | "skipped" | "failed";
  detail?: string;
}

export interface OutboxDeps {
  admin: AnyClient;
  siteUrl: string;
  resendApiKey?: string;
  from: string;
  testRecipient?: string;
  fetchImpl?: typeof fetch;
}

/** Busca os dados do agendamento usados no e-mail. */
export async function loadEmailData(
  admin: AnyClient,
  bookingId: string,
  siteUrl: string,
): Promise<{ data: EmailData; status: string; clientId: string } | null> {
  const { data } = await admin
    .from("bookings")
    .select(
      "status, starts_at, price_cents, client_id, services(name), professionals(display_name), profiles!bookings_client_id_fkey(full_name), shops(timezone)",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (!data) return null;
  const b = data as unknown as BookingDetails;
  return {
    status: b.status,
    clientId: b.client_id,
    data: {
      clientName: b.profiles.full_name,
      serviceName: b.services.name,
      professionalName: b.professionals.display_name,
      startsAt: b.starts_at,
      priceCents: b.price_cents,
      timeZone: b.shops.timezone,
      siteUrl,
    },
  };
}

/**
 * Processa um item reivindicado da fila. Garantias contra duplicidade:
 * 1) unique(booking_id, kind) no banco; 2) claim com FOR UPDATE SKIP LOCKED;
 * 3) Idempotency-Key no Resend, caso um item seja reprocessado apÃ³s falha parcial.
 */
export async function processOutboxRow(row: OutboxRow, deps: OutboxDeps): Promise<SendResult> {
  const finish = async (status: SendResult["status"], providerId?: string, detail?: string) => {
    await deps.admin.rpc("finish_outbox", {
      p_id: row.id,
      p_status: status,
      p_provider_message_id: providerId ?? null,
      p_error: detail ?? null,
    });
    return { id: row.id, status, detail };
  };

  const loaded = await loadEmailData(deps.admin, row.booking_id, deps.siteUrl);
  if (!loaded) return finish("skipped", undefined, "Agendamento nÃ£o encontrado");
  if (row.kind !== "cancellation" && loaded.status !== "confirmed") {
    return finish("skipped", undefined, "Agendamento nÃ£o estÃ¡ mais confirmado");
  }
  if (!deps.resendApiKey) {
    return finish("skipped", undefined, "Envio real desativado (RESEND_API_KEY ausente) â€” modo demonstraÃ§Ã£o");
  }

  let to = deps.testRecipient;
  if (!to) {
    const { data } = await deps.admin.auth.admin.getUserById(loaded.clientId);
    to = data.user?.email ?? undefined;
  }
  if (!to) return finish("failed", undefined, "DestinatÃ¡rio sem e-mail");

  const email = buildEmail(row.kind, loaded.data);
  try {
    const res = await (deps.fetchImpl ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${deps.resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `barbearia-outbox-${row.id}`,
      },
      body: JSON.stringify({ from: deps.from, to: [to], subject: email.subject, html: email.html, text: email.text }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      // Fica "processing"; apÃ³s 10 min Ã© reivindicado de novo (atÃ© 5 tentativas).
      await deps.admin.rpc("finish_outbox", {
        p_id: row.id,
        p_status: res.status >= 500 || res.status === 429 ? "pending" : "failed",
        p_provider_message_id: null,
        p_error: `Resend ${res.status}: ${body.message ?? "erro"}`,
      });
      return { id: row.id, status: "failed", detail: `HTTP ${res.status}` };
    }
    return finish("sent", body.id);
  } catch (err) {
    await deps.admin.rpc("finish_outbox", {
      p_id: row.id,
      p_status: "pending",
      p_provider_message_id: null,
      p_error: err instanceof Error ? err.name : "erro de rede",
    });
    return { id: row.id, status: "failed", detail: "erro de rede/timeout" };
  }
}
