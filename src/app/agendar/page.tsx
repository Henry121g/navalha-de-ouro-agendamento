import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { getShop, getViewer } from "@/lib/auth";
import {
  formatDateTime,
  formatDuration,
  formatLocalDay,
  formatMoney,
  formatTime,
  upcomingDays,
} from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { ConfirmForm } from "./confirm-form";

export const metadata: Metadata = { title: "Agendar" };

type Params = Record<string, string | undefined>;

function href(current: Params, patch: Params) {
  const next = { ...current, ...patch };
  const qs = new URLSearchParams(
    Object.entries(next).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""),
  );
  return `/agendar?${qs}`;
}

const option =
  "block rounded-xl border border-border bg-surface p-4 hover:border-brand aria-[current=true]:border-brand aria-[current=true]:ring-2 aria-[current=true]:ring-brand";

export default async function BookPage({ searchParams }: PageProps<"/agendar">) {
  const raw = await searchParams;
  const p: Params = {
    servico: typeof raw.servico === "string" ? raw.servico : undefined,
    profissional: typeof raw.profissional === "string" ? raw.profissional : undefined,
    dia: typeof raw.dia === "string" ? raw.dia : undefined,
    horario: typeof raw.horario === "string" ? raw.horario : undefined,
    reagendar: typeof raw.reagendar === "string" ? raw.reagendar : undefined,
  };

  const [shop, viewer, supabase] = await Promise.all([getShop(), getViewer(), createClient()]);
  const tz = shop.timezone;

  const { data: services, error: servicesError } = await supabase
    .from("services")
    .select("id, name, description, price_cents, duration_minutes")
    .eq("active", true)
    .order("price_cents");
  if (servicesError) throw servicesError;

  const service = services?.find((s) => s.id === p.servico);

  const { data: links } = service
    ? await supabase
        .from("professional_services")
        .select("professionals!inner(id, display_name, bio, active)")
        .eq("service_id", service.id)
        .eq("professionals.active", true)
    : { data: null };
  const professionals = (links ?? []).flatMap((l) => l.professionals);
  const professional = professionals.find((x) => x.id === p.profissional);

  const days = upcomingDays(14, tz);
  const day = p.dia && days.includes(p.dia) ? p.dia : undefined;

  let slots: string[] = [];
  let slotsError = false;
  if (service && professional && day) {
    const { data, error } = await supabase.rpc("available_slots", {
      p_professional: professional.id,
      p_service: service.id,
      p_day: day,
    });
    slotsError = Boolean(error);
    slots = (data ?? []).map((r: { starts_at: string }) => new Date(r.starts_at).toISOString());
  }
  const slot = p.horario && slots.includes(p.horario) ? p.horario : undefined;

  return (
    <div className="flex flex-col gap-10">
      <header>
        <h1 className="text-2xl font-bold">{p.reagendar ? "Reagendar horário" : "Agendar horário"}</h1>
        <p className="mt-1 text-sm text-muted">
          Horários no fuso de Brasília. Cancelamento e reagendamento pelo app até 2 h antes.
        </p>
      </header>

      <section aria-labelledby="passo-servico">
        <h2 id="passo-servico" className="mb-3 font-semibold">
          1. Serviço
        </h2>
        {services?.length ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {services.map((s) => (
              <li key={s.id}>
                <Link
                  href={href(p, { servico: s.id, profissional: undefined, dia: undefined, horario: undefined })}
                  aria-current={s.id === service?.id}
                  className={option}
                >
                  <span className="flex justify-between gap-2 font-semibold">
                    {s.name} <span>{formatMoney(s.price_cents)}</span>
                  </span>
                  <span className="text-sm text-muted">
                    {formatDuration(s.duration_minutes)} · {s.description}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nenhum serviço disponível no momento." />
        )}
      </section>

      {service && (
        <section aria-labelledby="passo-profissional">
          <h2 id="passo-profissional" className="mb-3 font-semibold">
            2. Profissional
          </h2>
          {professionals.length ? (
            <ul className="grid gap-3 sm:grid-cols-3">
              {professionals.map((pro) => (
                <li key={pro.id}>
                  <Link
                    href={href(p, { profissional: pro.id, horario: undefined })}
                    aria-current={pro.id === professional?.id}
                    className={option}
                  >
                    <span className="font-semibold">{pro.display_name}</span>
                    {pro.bio && <span className="block text-sm text-muted">{pro.bio}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nenhum profissional atende este serviço no momento." />
          )}
        </section>
      )}

      {service && professional && (
        <section aria-labelledby="passo-dia">
          <h2 id="passo-dia" className="mb-3 font-semibold">
            3. Dia
          </h2>
          <ul className="flex flex-wrap gap-2">
            {days.map((d) => (
              <li key={d}>
                <Link
                  href={href(p, { dia: d, horario: undefined })}
                  aria-current={d === day}
                  className={`${option} px-3 py-2 text-sm capitalize`}
                >
                  {formatLocalDay(d)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {service && professional && day && (
        <section aria-labelledby="passo-horario">
          <h2 id="passo-horario" className="mb-3 font-semibold">
            4. Horário
          </h2>
          {slotsError ? (
            <p role="alert" className="text-danger">
              Não foi possível carregar os horários. Atualize a página.
            </p>
          ) : slots.length ? (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {slots.map((s) => (
                <li key={s}>
                  <Link
                    href={href(p, { horario: s })}
                    aria-current={s === slot}
                    className={`${option} p-2 text-center text-sm`}
                  >
                    {formatTime(s, tz)}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Sem horários livres neste dia.">Experimente outro dia ou profissional.</EmptyState>
          )}
        </section>
      )}

      {service && professional && slot && (
        <section aria-label="Confirmação">
          {viewer ? (
            <ConfirmForm
              professionalId={professional.id}
              serviceId={service.id}
              startsAt={slot}
              rescheduleFrom={p.reagendar}
              summary={
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted">Serviço</dt>
                  <dd>{service.name}</dd>
                  <dt className="text-muted">Profissional</dt>
                  <dd>{professional.display_name}</dd>
                  <dt className="text-muted">Quando</dt>
                  <dd className="capitalize">{formatDateTime(slot, tz)}</dd>
                  <dt className="text-muted">Valor</dt>
                  <dd>{formatMoney(service.price_cents)} (pagamento na barbearia)</dd>
                </dl>
              }
            />
          ) : (
            <div className="rounded-xl border border-border bg-surface p-5">
              <p className="mb-3">Entre ou crie uma conta para confirmar o horário.</p>
              <Link
                href={`/entrar?proximo=${encodeURIComponent(href(p, {}))}`}
                className="font-semibold text-brand underline"
              >
                Entrar para confirmar
              </Link>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
