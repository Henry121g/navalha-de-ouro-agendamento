import type { Metadata } from "next";
import { EmptyState } from "@/components/empty-state";
import { getShop, requireViewer } from "@/lib/auth";
import { buildEmail, type EmailKind } from "@/lib/email-templates";
import { publicEnv } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "E-mails" };

const KIND_LABEL: Record<EmailKind, string> = {
  confirmation: "Confirmação",
  reminder_24h: "Lembrete (24 h antes)",
  cancellation: "Cancelamento",
};

const STATUS: Record<string, string> = {
  pending: "Agendado",
  processing: "Enviando",
  sent: "Enviado",
  skipped: "Não enviado",
  failed: "Falhou",
};

interface Row {
  id: number;
  kind: EmailKind;
  status: string;
  send_after: string;
  sent_at: string | null;
  last_error: string | null;
  bookings: {
    starts_at: string;
    price_cents: number;
    services: { name: string };
    professionals: { display_name: string };
    profiles: { full_name: string };
  };
}

export default async function EmailsPage() {
  const viewer = await requireViewer("/emails");
  const [shop, supabase] = await Promise.all([getShop(), createClient()]);
  // RLS: cliente vê e-mails dos próprios agendamentos; equipe vê os da barbearia.
  const { data } = await supabase
    .from("notification_outbox")
    .select(
      "id, kind, status, send_after, sent_at, last_error, bookings(starts_at, price_cents, services(name), professionals(display_name), profiles!bookings_client_id_fkey(full_name))",
    )
    .order("send_after", { ascending: false })
    .limit(30);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-bold">Caixa de e-mails</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Registro dos e-mails transacionais gerados pelo sistema. Nesta demonstração, o envio real só
          alcança o e-mail do dono da conta Resend (domínio de teste), por isso o conteúdo de cada
          mensagem aparece aqui. Cada agendamento recebe no máximo um e-mail de cada tipo.
        </p>
      </header>
      {rows.length === 0 ? (
        <EmptyState title="Nenhum e-mail ainda.">
          {viewer.role === "client" ? "Faça um agendamento para ver a confirmação aqui." : null}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => {
            const email = buildEmail(r.kind, {
              clientName: r.bookings.profiles.full_name,
              serviceName: r.bookings.services.name,
              professionalName: r.bookings.professionals.display_name,
              startsAt: r.bookings.starts_at,
              priceCents: r.bookings.price_cents,
              timeZone: shop.timezone,
              siteUrl: publicEnv.NEXT_PUBLIC_SITE_URL,
            });
            return (
              <li key={r.id} className="rounded-xl border border-border bg-surface p-4">
                <details>
                  <summary className="cursor-pointer">
                    <span className="font-semibold">{email.subject}</span>
                    <span className="block text-sm text-muted">
                      {KIND_LABEL[r.kind]} · {STATUS[r.status] ?? r.status} ·{" "}
                      {r.status === "pending" ? "previsto para " : ""}
                      <span className="capitalize">{formatDateTime(r.sent_at ?? r.send_after, shop.timezone)}</span>
                    </span>
                  </summary>
                  <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-background p-3 font-sans text-sm">
                    {email.text}
                  </pre>
                  {r.last_error && <p className="mt-2 text-xs text-muted">Observação: {r.last_error}</p>}
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
