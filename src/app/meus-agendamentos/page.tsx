import type { Metadata } from "next";
import Link from "next/link";
import { CancelButton } from "@/components/cancel-button";
import { EmptyState } from "@/components/empty-state";
import { Alert, buttonStyles } from "@/components/ui";
import { getShop, requireViewer } from "@/lib/auth";
import { formatDateTime, formatMoney, STATUS_LABEL } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { requestNow } from "@/lib/time";

export const metadata: Metadata = { title: "Meus agendamentos" };

interface Row {
  id: string;
  starts_at: string;
  status: string;
  price_cents: number;
  cancel_reason: string | null;
  services: { id: string; name: string };
  professionals: { id: string; display_name: string };
}

export default async function MyBookingsPage({ searchParams }: PageProps<"/meus-agendamentos">) {
  const viewer = await requireViewer("/meus-agendamentos");
  const [{ confirmado }, shop, supabase] = await Promise.all([searchParams, getShop(), createClient()]);

  const { data, error } = await supabase
    .from("bookings")
    .select("id, starts_at, status, price_cents, cancel_reason, services(id, name), professionals(id, display_name)")
    .eq("client_id", viewer.id)
    .order("starts_at", { ascending: false })
    .limit(50);

  const rows = ((data ?? []) as unknown as Row[]).map((r) => ({ ...r, start: new Date(r.starts_at) }));
  const now = requestNow();
  const deadlineMs = 2 * 3_600_000; // espelha cancel_deadline padrão; o banco é quem decide
  const upcoming = rows.filter((r) => r.status === "confirmed" && r.start.getTime() > now).reverse();
  const past = rows.filter((r) => !upcoming.includes(r));

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold">Meus agendamentos</h1>
      {confirmado && (
        <Alert kind="success">
          Agendamento confirmado! A confirmação foi registrada na sua <Link href="/emails" className="underline">caixa de e-mails</Link>.
        </Alert>
      )}
      {error && <Alert kind="error">Não foi possível carregar seus agendamentos. Atualize a página.</Alert>}

      <section aria-labelledby="proximos">
        <h2 id="proximos" className="mb-3 text-lg font-semibold">
          Próximos
        </h2>
        {upcoming.length ? (
          <ul className="flex flex-col gap-3">
            {upcoming.map((r) => {
              const when = formatDateTime(r.start, shop.timezone);
              const canChange = r.start.getTime() - now > deadlineMs;
              return (
                <li key={r.id} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:flex-row sm:items-center">
                  <div className="flex-1">
                    <p className="font-semibold capitalize">{when}</p>
                    <p className="text-sm text-muted">
                      {r.services.name} com {r.professionals.display_name} · {formatMoney(r.price_cents)}
                    </p>
                  </div>
                  {canChange ? (
                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={`/agendar?servico=${r.services.id}&profissional=${r.professionals.id}&reagendar=${r.id}`}
                        className={buttonStyles.secondary}
                      >
                        Reagendar <span className="sr-only">{when}</span>
                      </Link>
                      <CancelButton bookingId={r.id} label={`o horário de ${when}`} />
                    </div>
                  ) : (
                    <p className="text-sm text-muted">Menos de 2 h para o horário: fale com a barbearia para alterar.</p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="Você não tem horários marcados.">
            <Link href="/agendar" className="font-semibold text-brand underline">
              Agendar agora
            </Link>
          </EmptyState>
        )}
      </section>

      {past.length > 0 && (
        <section aria-labelledby="historico">
          <h2 id="historico" className="mb-3 text-lg font-semibold">
            Histórico
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
            {past.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 p-4 text-sm">
                <span className="capitalize">{formatDateTime(r.start, shop.timezone)}</span>
                <span>
                  {r.services.name} · {STATUS_LABEL[r.status]}
                  {r.cancel_reason && <span className="text-muted"> ({r.cancel_reason})</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
