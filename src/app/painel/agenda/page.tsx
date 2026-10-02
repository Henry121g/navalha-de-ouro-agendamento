import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { buttonStyles } from "@/components/ui";
import { getShop, requireViewer } from "@/lib/auth";
import { formatDay, formatTime, localDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { deleteTimeOff } from "../actions";
import { TimeOffForm, WorkingHoursForm } from "../forms";

export const metadata: Metadata = { title: "Expediente e bloqueios" };

export default async function SchedulePage({ searchParams }: PageProps<"/painel/agenda">) {
  const viewer = await requireViewer("/painel/agenda", ["admin", "professional"]);
  const [{ profissional }, shop, supabase] = await Promise.all([searchParams, getShop(), createClient()]);

  const { data: pros } = await supabase.from("professionals").select("id, display_name").order("display_name");
  const professionals = pros ?? [];
  // Profissional só gerencia a própria agenda; admin escolhe qual profissional.
  const selectedId =
    viewer.role === "professional"
      ? viewer.id
      : professionals.find((p) => p.id === profissional)?.id ?? professionals[0]?.id;

  if (!selectedId) return <EmptyState title="Nenhum profissional cadastrado." />;

  const [{ data: hours }, { data: offs }] = await Promise.all([
    supabase.from("working_hours").select("weekday, start_time, end_time").eq("professional_id", selectedId),
    supabase
      .from("time_off")
      .select("id, starts_at, ends_at, reason")
      .eq("professional_id", selectedId)
      .gt("ends_at", new Date().toISOString())
      .order("starts_at"),
  ]);
  const byWeekday = new Map((hours ?? []).map((h) => [h.weekday as number, h]));
  const tz = shop.timezone;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-2xl font-bold">Expediente e bloqueios</h1>

      {viewer.role === "admin" && (
        <nav aria-label="Profissional" className="flex flex-wrap gap-2 text-sm">
          {professionals.map((p) => (
            <Link
              key={p.id}
              href={`/painel/agenda?profissional=${p.id}`}
              aria-current={p.id === selectedId}
              className={`${buttonStyles.secondary} aria-[current=true]:border-brand aria-[current=true]:text-brand`}
            >
              {p.display_name}
            </Link>
          ))}
        </nav>
      )}

      <section aria-labelledby="expediente">
        <h2 id="expediente" className="mb-1 text-lg font-semibold">
          Expediente semanal
        </h2>
        <p className="mb-3 text-sm text-muted">Horários no fuso de Brasília.</p>
        <div className="grid gap-3 md:grid-cols-2">
          {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
            const h = byWeekday.get(wd);
            return (
              <WorkingHoursForm
                key={`${selectedId}-${wd}`}
                professionalId={selectedId}
                weekday={wd}
                start={h?.start_time?.slice(0, 5)}
                end={h?.end_time?.slice(0, 5)}
              />
            );
          })}
        </div>
      </section>

      <section aria-labelledby="bloqueios" className="flex flex-col gap-4">
        <h2 id="bloqueios" className="text-lg font-semibold">
          Bloqueios (folgas, almoço, compromissos)
        </h2>
        <TimeOffForm key={selectedId} professionalId={selectedId} minDay={localDate(new Date(), tz)} />
        {offs?.length ? (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
            {offs.map((o) => {
              const start = new Date(o.starts_at);
              const end = new Date(o.ends_at);
              const label = `${formatDay(start, tz)}, ${formatTime(start, tz)}–${formatTime(end, tz)}`;
              return (
                <li key={o.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <span className="capitalize">
                    {label} {o.reason && <span className="text-muted">· {o.reason}</span>}
                  </span>
                  <form action={deleteTimeOff}>
                    <input type="hidden" name="id" value={o.id} />
                    <button className={buttonStyles.danger}>
                      Remover <span className="sr-only">bloqueio de {label}</span>
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="Nenhum bloqueio futuro." />
        )}
      </section>
    </div>
  );
}
