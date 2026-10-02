"use client";

import { useActionState } from "react";
import { Alert, Field, SubmitButton } from "@/components/ui";
import { addTimeOff, saveService, saveWorkingHours, type ActionState } from "./actions";

function Feedback({ state }: { state: ActionState }) {
  if (state.error) return <Alert kind="error">{state.error}</Alert>;
  if (state.success) return <Alert kind="success">{state.success}</Alert>;
  return null;
}

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export function WorkingHoursForm(props: { professionalId: string; weekday: number; start?: string; end?: string }) {
  const [state, action] = useActionState(saveWorkingHours, {});
  const prefix = `dia-${props.professionalId}-${props.weekday}`;
  return (
    <form action={action} className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <fieldset className="flex flex-wrap items-end gap-3">
        <legend className="mb-1 w-full font-medium">{WEEKDAYS[props.weekday]}</legend>
        <input type="hidden" name="professionalId" value={props.professionalId} />
        <input type="hidden" name="weekday" value={props.weekday} />
        <label className="flex flex-col text-sm" htmlFor={`${prefix}-inicio`}>
          Início
          <input id={`${prefix}-inicio`} type="time" name="start" defaultValue={props.start} step={900} className="min-h-11 rounded-lg border border-border bg-surface px-2" />
        </label>
        <label className="flex flex-col text-sm" htmlFor={`${prefix}-fim`}>
          Fim
          <input id={`${prefix}-fim`} type="time" name="end" defaultValue={props.end} step={900} className="min-h-11 rounded-lg border border-border bg-surface px-2" />
        </label>
        <SubmitButton variant="secondary" pendingLabel="Salvando…">
          Salvar <span className="sr-only">{WEEKDAYS[props.weekday]}</span>
        </SubmitButton>
      </fieldset>
      <p className="text-xs text-muted">Deixe vazio para folga.</p>
      <Feedback state={state} />
    </form>
  );
}

export function TimeOffForm({ professionalId, minDay }: { professionalId: string; minDay: string }) {
  const [state, action] = useActionState(addTimeOff, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="professionalId" value={professionalId} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Data" name="day" type="date" min={minDay} required />
        <Field label="Início" name="start" type="time" step={900} required />
        <Field label="Fim" name="end" type="time" step={900} required />
        <Field label="Motivo (opcional)" name="reason" maxLength={120} />
      </div>
      <Feedback state={state} />
      <SubmitButton pendingLabel="Adicionando…" className="self-start">
        Adicionar bloqueio
      </SubmitButton>
    </form>
  );
}

export function ServiceForm(props: {
  id?: string;
  name?: string;
  description?: string | null;
  price?: string;
  duration?: number;
  active?: boolean;
}) {
  const [state, action] = useActionState(saveService, {});
  const key = props.id ?? "novo";
  return (
    <form action={action} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      {props.id && <input type="hidden" name="id" value={props.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nome" name="name" id={`nome-${key}`} defaultValue={props.name} required maxLength={60} />
        <Field label="Descrição" name="description" id={`descricao-${key}`} defaultValue={props.description ?? ""} maxLength={300} />
        <Field label="Preço (R$)" name="price" id={`preco-${key}`} inputMode="decimal" defaultValue={props.price} placeholder="45,00" required />
        <Field label="Duração (min)" name="duration" id={`duracao-${key}`} type="number" min={5} max={480} step={5} defaultValue={props.duration ?? 30} required />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={props.active ?? true} className="size-5" /> Ativo (visível para clientes)
      </label>
      <Feedback state={state} />
      <SubmitButton pendingLabel="Salvando…" className="self-start">
        {props.id ? "Salvar alterações" : "Criar serviço"}
      </SubmitButton>
    </form>
  );
}
