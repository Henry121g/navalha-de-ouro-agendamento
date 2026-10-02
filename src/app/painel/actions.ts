"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireViewer } from "@/lib/auth";
import { friendlyDbError } from "@/lib/errors";
import { parseMoneyToCents } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";

export interface ActionState {
  error?: string;
  success?: string;
}

const outcomeSchema = z.object({
  bookingId: z.uuid(),
  status: z.enum(["completed", "no_show"]),
});

export async function setOutcome(formData: FormData) {
  await requireViewer("/painel", ["admin", "professional"]);
  const parsed = outcomeSchema.safeParse({
    bookingId: formData.get("bookingId"),
    status: formData.get("status"),
  });
  if (!parsed.success) return;
  const supabase = await createClient();
  await supabase.rpc("set_booking_outcome", { p_booking: parsed.data.bookingId, p_status: parsed.data.status });
  revalidatePath("/painel");
}

const timeOffSchema = z.object({
  professionalId: z.uuid(),
  day: z.iso.date({ message: "Informe a data." }),
  start: z.string().regex(/^\d{2}:\d{2}$/, "Informe o início."),
  end: z.string().regex(/^\d{2}:\d{2}$/, "Informe o fim."),
  reason: z.string().trim().max(120).optional(),
});

export async function addTimeOff(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireViewer("/painel/agenda", ["admin", "professional"]);
  const parsed = timeOffSchema.safeParse({
    professionalId: formData.get("professionalId"),
    day: formData.get("day"),
    start: formData.get("start"),
    end: formData.get("end"),
    reason: formData.get("reason") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_time_off", {
    p_professional: parsed.data.professionalId,
    p_day: parsed.data.day,
    p_start: parsed.data.start,
    p_end: parsed.data.end,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/painel/agenda");
  return { success: "Bloqueio adicionado. Esses horários não aparecem mais para clientes." };
}

export async function deleteTimeOff(formData: FormData) {
  await requireViewer("/painel/agenda", ["admin", "professional"]);
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return;
  const supabase = await createClient();
  await supabase.from("time_off").delete().eq("id", id.data); // RLS restringe ao dono ou admin
  revalidatePath("/painel/agenda");
}

const hoursSchema = z.object({
  professionalId: z.uuid(),
  weekday: z.coerce.number().int().min(0).max(6),
  start: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  end: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

/** Substitui o expediente de um dia da semana (sem início/fim = folga). */
export async function saveWorkingHours(_: ActionState, formData: FormData): Promise<ActionState> {
  await requireViewer("/painel/agenda", ["admin", "professional"]);
  const parsed = hoursSchema.safeParse({
    professionalId: formData.get("professionalId"),
    weekday: formData.get("weekday"),
    start: formData.get("start") || undefined,
    end: formData.get("end") || undefined,
  });
  if (!parsed.success) return { error: "Horário inválido." };
  const { professionalId, weekday, start, end } = parsed.data;
  if ((start && !end) || (!start && end)) return { error: "Informe início e fim, ou deixe ambos vazios para folga." };
  if (start && end && end <= start) return { error: "O fim do expediente precisa ser depois do início." };

  const supabase = await createClient();
  const del = await supabase
    .from("working_hours")
    .delete()
    .eq("professional_id", professionalId)
    .eq("weekday", weekday);
  if (del.error) return { error: friendlyDbError(del.error) };
  if (start && end) {
    const ins = await supabase
      .from("working_hours")
      .insert({ professional_id: professionalId, weekday, start_time: start, end_time: end });
    if (ins.error) return { error: friendlyDbError(ins.error) };
  }
  revalidatePath("/painel/agenda");
  return { success: "Expediente salvo." };
}

const serviceSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Nome muito curto.").max(60),
  description: z.string().trim().max(300).optional(),
  price: z.string().transform((v, ctx) => {
    const cents = parseMoneyToCents(v);
    if (cents === null) {
      ctx.addIssue({ code: "custom", message: "Preço inválido. Use o formato 45,00." });
      return z.NEVER;
    }
    return cents;
  }),
  duration: z.coerce
    .number()
    .int()
    .min(5, "Duração mínima de 5 min.")
    .max(480)
    .refine((n) => n % 5 === 0, "Use múltiplos de 5 minutos."),
  active: z.boolean(),
});

export async function saveService(_: ActionState, formData: FormData): Promise<ActionState> {
  const viewer = await requireViewer("/painel/servicos", ["admin"]);
  const parsed = serviceSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    price: formData.get("price"),
    duration: formData.get("duration"),
    active: formData.get("active") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { id, name, description, price, duration, active } = parsed.data;
  const supabase = await createClient();
  const row = { name, description: description ?? null, price_cents: price, duration_minutes: duration, active };
  const { error } = id
    ? await supabase.from("services").update(row).eq("id", id)
    : await supabase.from("services").insert({ ...row, shop_id: viewer.shopId });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/painel/servicos");
  revalidatePath("/agendar");
  return { success: id ? "Serviço atualizado. Agendamentos já feitos mantêm o preço original." : "Serviço criado." };
}
