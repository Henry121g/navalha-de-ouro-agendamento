import type { Metadata } from "next";
import { requireViewer } from "@/lib/auth";
import { centsToInput } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { ServiceForm } from "../forms";

export const metadata: Metadata = { title: "Serviços" };

export default async function ServicesPage() {
  await requireViewer("/painel/servicos", ["admin"]);
  const supabase = await createClient();
  const { data: services } = await supabase
    .from("services")
    .select("id, name, description, price_cents, duration_minutes, active")
    .order("name");

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-bold">Serviços</h1>
        <p className="mt-1 text-sm text-muted">
          Alterar o preço não muda agendamentos já feitos: o valor é registrado no momento da reserva.
        </p>
      </header>
      <section aria-labelledby="novo-servico">
        <h2 id="novo-servico" className="mb-3 text-lg font-semibold">
          Novo serviço
        </h2>
        <ServiceForm />
      </section>
      <section aria-labelledby="existentes" className="flex flex-col gap-3">
        <h2 id="existentes" className="text-lg font-semibold">
          Serviços cadastrados
        </h2>
        {(services ?? []).map((s) => (
          <ServiceForm
            key={s.id}
            id={s.id}
            name={s.name}
            description={s.description}
            price={centsToInput(s.price_cents)}
            duration={s.duration_minutes}
            active={s.active}
          />
        ))}
      </section>
    </div>
  );
}
