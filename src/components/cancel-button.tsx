"use client";

import { useActionState, useRef } from "react";
import { cancelBooking } from "@/app/meus-agendamentos/actions";
import { Alert, SubmitButton } from "@/components/ui";
import { buttonStyles } from "@/components/button-styles";

/** Cancelamento com confirmação em <dialog> nativo (foco preso e Esc para fechar). */
export function CancelButton({ bookingId, label }: { bookingId: string; label: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, formAction] = useActionState(cancelBooking, {});
  const titleId = `cancelar-${bookingId}`;

  if (state.success) return <Alert kind="success">{state.success}</Alert>;

  return (
    <>
      <button type="button" className={buttonStyles.danger} onClick={() => dialog.current?.showModal()}>
        Cancelar <span className="sr-only">{label}</span>
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto w-[min(28rem,calc(100%-2rem))] rounded-xl border border-border bg-surface p-5 text-foreground backdrop:bg-black/50"
      >
        <form action={formAction} className="flex flex-col gap-4">
          <h2 id={titleId} className="text-lg font-semibold">
            Cancelar {label}?
          </h2>
          {state.error && <Alert kind="error">{state.error}</Alert>}
          <input type="hidden" name="bookingId" value={bookingId} />
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Motivo (opcional)
            <textarea
              name="reason"
              maxLength={300}
              rows={3}
              className="rounded-lg border border-border bg-background px-3 py-2 text-base font-normal"
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={buttonStyles.secondary} onClick={() => dialog.current?.close()}>
              Manter agendamento
            </button>
            <SubmitButton variant="danger" pendingLabel="Cancelando…">
              Confirmar cancelamento
            </SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
