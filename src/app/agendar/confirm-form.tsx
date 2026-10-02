"use client";

import { useActionState } from "react";
import { Alert, SubmitButton } from "@/components/ui";
import { bookAppointment } from "./actions";

export function ConfirmForm(props: {
  professionalId: string;
  serviceId: string;
  startsAt: string;
  rescheduleFrom?: string;
  summary: React.ReactNode;
}) {
  const [state, formAction] = useActionState(bookAppointment, {});
  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">{props.rescheduleFrom ? "Confirmar reagendamento" : "Confirmar agendamento"}</h2>
      {props.summary}
      {state.error && <Alert kind="error">{state.error}</Alert>}
      <input type="hidden" name="professionalId" value={props.professionalId} />
      <input type="hidden" name="serviceId" value={props.serviceId} />
      <input type="hidden" name="startsAt" value={props.startsAt} />
      {props.rescheduleFrom && <input type="hidden" name="rescheduleFrom" value={props.rescheduleFrom} />}
      <SubmitButton pendingLabel="Reservando…">
        {props.rescheduleFrom ? "Confirmar novo horário" : "Confirmar agendamento"}
      </SubmitButton>
    </form>
  );
}
