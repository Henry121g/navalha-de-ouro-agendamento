"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { friendlyDbError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export interface CancelState {
  error?: string;
  success?: string;
}

const cancelSchema = z.object({
  bookingId: z.uuid(),
  reason: z.string().trim().max(300, "Motivo muito longo (máx. 300 caracteres).").optional(),
});

export async function cancelBooking(_: CancelState, formData: FormData): Promise<CancelState> {
  const parsed = cancelSchema.safeParse({
    bookingId: formData.get("bookingId"),
    reason: formData.get("reason") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const supabase = await createClient();
  // Prazo e permissão são verificados pela função no banco (cliente: até 2 h antes; equipe: sempre).
  const { error } = await supabase.rpc("cancel_booking", {
    p_booking: parsed.data.bookingId,
    p_reason: parsed.data.reason ?? null,
  });
  if (error) return { error: friendlyDbError(error) };

  revalidatePath("/meus-agendamentos");
  revalidatePath("/painel");
  return { success: "Agendamento cancelado. O horário foi liberado." };
}
