import type { Metadata } from "next";
import Link from "next/link";
import { CancelButton } from "@/components/cancel-button";
import { EmptyState } from "@/components/empty-state";
import { Alert } from "@/components/ui";
import { buttonStyles } from "@/components/button-styles";
import { getShop, requireViewer } from "@/lib/auth";
import { formatLocalDay, formatMoney, formatTime, localDate, STATUS_LABEL, zonedToUtcIso } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { requestNow } from "@/lib/time";
import { setOutcome } from "./actions";

export const metadata: Metadata = { title: "Painel" };

interface Row {
  id: string;
  starts_at: string;
  status: string;
  price_cents: number;
  services: { name: string };
  professionals: { display_name: string };
  profiles: { full_name: string };
}

/** Segunda-feira (AAAA-MM-DD) da semana de `day`. */
function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default async function PanelPage({ searchParams }: PageProps<"/painel">) {
  const viewer = await requireViewer("/painel", ["admin", "professional"]);
  const [{ semana }, shop, supabase] = await Promise.all([searchParams, getShop(), createClient()]);
  const tz = shop.timezone;
  const today = localDate(new Date(), tz);
  const start = mondayOf(typeof semana === "string" && /^\d{4}-\d{2}-\d{2}$/.test(semana) ? semana : today);
  const end = addDays(start, 7);
  // Limites da semana no fuso da barbearia.
  const fromIso = zonedToUtcIso(start, "00:00", tz);
  const toIso = zonedToUtcIso(end, "00:00", tz);

  let query = supabase
    .from("bookings")
    .select("id, starts_at, status, price_cents, services(name), professionals(display_name), profiles!bookings_client_id_fkey(full_name)")
    .gte("starts_at", fromIso)
    .lt("starts_at", toIso)
    .order("starts_at");
  if (viewer.role === "professional") query = query.eq("professional_id", viewer.id);
  const { data, error } = await query;
  const rows = (data ?? []) as unknown as Row[];

  const metrics =
    viewer.role === "admin"
      ? (await supabase.rpc("dashboard_metrics", { p_from: fromIso, p_to: toIso })).data?.[0]
      : null;

  const byDay = new Map<string, Row[]>();
  for (const r of rows) {
    const d = localDate(new Date(r.starts_at), tz);
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }
  const now = requestNow();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          {viewer.role === "admin" ? "Painel da barbearia" : "Minha agenda"}
        </h1>
        <nav aria-label="Semana" className="flex items-center gap-2 text-sm">
          <Link href={`/painel?semana=${addDays(start, -7)}`} className={buttonStyles.secondary}>
            ← <span className="sr-only">Semana</span> anterior
          </Link>
          <span aria-live="polite" className="px-2 font-medium capitalize">
            {formatLocalDay(start)} – {formatLocalDay(addDays(start, 6))}
          </span>
          <Link href={`/painel?semana=${addDays(start, 7)}`} className={buttonStyles.secondary}>
            Próxima <span className="sr-only">semana</span> →
          </Link>
        </nav>
      </header>

      {error && <Alert kind="error">Não foi possível carregar a agenda. Atualize a página.</Alert>}

      {metrics && (
        <section aria-labelledby="indicadores">
          <h2 id="indicadores" className="sr-only">
            Indicadores da semana
          </h2>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Agendamentos", String(metrics.total_bookings)],
              [
                "Taxa de cancelamento",
                Number(metrics.total_bookings) > 0
                  ? `${Math.round((Number(metrics.cancelled) / Number(metrics.total_bookings)) * 100)}%`
                  : "—",
              ],
              ["Faturamento previsto", formatMoney(Number(metrics.expected_revenue_cents))],
              ["Faturamento realizado", formatMoney(Number(metrics.realized_revenue_cents))],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border bg-surface p-4">
                <dt className="text-sm text-muted">{label}</dt>
                <dd className="mt-1 text-2xl font-bold">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted">
            Previsto = confirmados + concluídos. Realizado = concluídos. Cancelamentos não entram no faturamento.
          </p>
        </section>
      )}

      <section aria-labelledby="agenda">
        <h2 id="agenda" className="mb-3 text-lg font-semibold">
          Agenda
        </h2>
        {rows.length === 0 ? (
          <EmptyState title="Nenhum agendamento nesta semana." />
        ) : (
          <div className="flex flex-col gap-6">
            {[...byDay.entries()].map(([day, list]) => (
              <section key={day} aria-label={formatLocalDay(day)}>
                <h3 className="mb-2 font-semibold capitalize">
                  {formatLocalDay(day)} {day === today && <span className="text-sm text-brand">(hoje)</span>}
                </h3>
                <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
                  {list.map((r) => {
                    const time = formatTime(r.starts_at, tz);
                    const past = new Date(r.starts_at).getTime() <= now;
                    const label = `${r.profiles.full_name} às ${time}`;
                    return (
                      <li key={r.id} className="flex flex-col gap-2 p-3 text-sm sm:flex-row sm:items-center">
                        <span className="w-14 font-mono font-semibold">{time}</span>
                        <span className="flex-1">
                          {r.profiles.full_name} · {r.services.name}
                          {viewer.role === "admin" && ` · ${r.professionals.display_name}`}
                          <span className="block text-muted">
                            {STATUS_LABEL[r.status]} · {formatMoney(r.price_cents)}
                          </span>
                        </span>
                        {r.status === "confirmed" && !past && <CancelButton bookingId={r.id} label={label} />}
                        {r.status === "confirmed" && past && (
                          <form action={setOutcome} className="flex gap-2">
                            <input type="hidden" name="bookingId" value={r.id} />
                            <button name="status" value="completed" className={buttonStyles.secondary}>
                              Concluído <span className="sr-only">{label}</span>
                            </button>
                            <button name="status" value="no_show" className={buttonStyles.secondary}>
                              Não compareceu <span className="sr-only">{label}</span>
                            </button>
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
