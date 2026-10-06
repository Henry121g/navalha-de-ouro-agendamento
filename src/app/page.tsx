import Link from "next/link";
import { buttonStyles } from "@/components/button-styles";
import { formatDuration, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: services } = await supabase
    .from("services")
    .select("id, name, price_cents, duration_minutes")
    .eq("active", true)
    .order("price_cents");

  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col items-start gap-4 py-6">
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight">
          Seu horário na barbearia, sem troca de mensagens.
        </h1>
        <p className="max-w-xl text-lg text-muted">
          Escolha o serviço, o barbeiro e um horário livre. A confirmação chega por e-mail, e você
          cancela ou reagenda até 2 horas antes.
        </p>
        <Link href="/agendar" className={buttonStyles.primary}>
          Agendar horário
        </Link>
      </section>

      <section aria-labelledby="servicos">
        <h2 id="servicos" className="mb-4 text-xl font-semibold">
          Serviços
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {(services ?? []).map((s) => (
            <li key={s.id}>
              <Link href={`/agendar?servico=${s.id}`} className="flex justify-between rounded-xl border border-border bg-surface p-4 hover:border-brand">
                <span>
                  <span className="font-semibold">{s.name}</span>
                  <span className="block text-sm text-muted">{formatDuration(s.duration_minutes)}</span>
                </span>
                <span className="font-semibold">{formatMoney(s.price_cents)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="como-funciona" className="grid gap-4 sm:grid-cols-3">
        <h2 id="como-funciona" className="sr-only">
          Como funciona
        </h2>
        {[
          ["Sem conflito de horário", "Duas pessoas nunca reservam o mesmo horário do mesmo barbeiro — nem se clicarem ao mesmo tempo."],
          ["Regras claras", "Cancelamento e reagendamento pelo app até 2 h antes. Depois disso, fale com a barbearia."],
          ["Lembrete automático", "Um e-mail de confirmação na reserva e um lembrete 24 h antes, sem duplicatas."],
        ].map(([title, text]) => (
          <div key={title} className="rounded-xl border border-border bg-surface p-4">
            <h3 className="font-semibold">{title}</h3>
            <p className="mt-1 text-sm text-muted">{text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
