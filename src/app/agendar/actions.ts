"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { friendlyDbError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export interface BookState {
  error?: string;
}

const bookSchema = z.object({
  professionalId: z.uuid(),
  serviceId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  rescheduleFrom: z.uuid().optional(),
});

export async function bookAppointment(_: BookState, formData: FormData): Promise<BookState> {
  const parsed = bookSchema.safeParse({
    professionalId: formData.get("professionalId"),
    serviceId: formData.get("serviceId"),
    startsAt: formData.get("startsAt"),
    rescheduleFrom: formData.get("rescheduleFrom") || undefined,
  });
  if (!parsed.success) return { error: "Dados do agendamento inválidos. Recomece a escolha." };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/entrar?proximo=/agendar");

  // Toda a regra (disponibilidade, concorrência, prazo de reagendamento) roda no banco, numa transação.
  const { data, error } = await supabase.rpc("book_appointment", {
    p_professional: parsed.data.professionalId,
    p_service: parsed.data.serviceId,
    p_start: parsed.data.startsAt,
    p_reschedule_from: parsed.data.rescheduleFrom ?? null,
  });
  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/meus-agendamentos");
  redirect(`/meus-agendamentos?confirmado=${data}`);
}
