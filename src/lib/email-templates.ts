import { formatDateTime, formatMoney } from "./format";

export type EmailKind = "confirmation" | "reminder_24h" | "cancellation";

export interface EmailData {
  clientName: string;
  serviceName: string;
  professionalName: string;
  startsAt: string;
  priceCents: number;
  timeZone: string;
  siteUrl: string;
}

export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function buildEmail(kind: EmailKind, d: EmailData): EmailContent {
  const when = formatDateTime(d.startsAt, d.timeZone);
  const details = `${d.serviceName} com ${d.professionalName}\n${when} (horário de Brasília)\nValor: ${formatMoney(d.priceCents)}`;
  const link = `${d.siteUrl}/meus-agendamentos`;

  const copy: Record<EmailKind, { subject: string; intro: string; outro: string }> = {
    confirmation: {
      subject: `Agendamento confirmado: ${when}`,
      intro: `Olá, ${d.clientName}! Seu horário está confirmado.`,
      outro: "Precisa mudar? Cancele ou reagende pelo app até 2 horas antes.",
    },
    reminder_24h: {
      subject: `Lembrete: seu horário é amanhã, ${when}`,
      intro: `Olá, ${d.clientName}! Passando para lembrar do seu horário.`,
      outro: "Não vai conseguir ir? Cancele pelo app até 2 horas antes para liberar o horário.",
    },
    cancellation: {
      subject: `Agendamento cancelado: ${when}`,
      intro: `Olá, ${d.clientName}. O agendamento abaixo foi cancelado.`,
      outro: "Quer marcar outro horário? É só acessar o app.",
    },
  };
  const c = copy[kind];
  const text = `${c.intro}\n\n${details}\n\n${c.outro}\n${link}\n\n— Navalha de Ouro (projeto de portfólio, dados fictícios)`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;color:#1c1917">
<p>${escapeHtml(c.intro)}</p>
<p style="padding:12px;border:1px solid #d6d3d1;border-radius:8px">${escapeHtml(details).replace(/\n/g, "<br>")}</p>
<p>${escapeHtml(c.outro)}</p>
<p><a href="${escapeHtml(link)}">Ver meus agendamentos</a></p>
<p style="font-size:12px;color:#57534e">Navalha de Ouro — projeto de portfólio com dados fictícios.</p>
</div>`;
  return { subject: c.subject, text, html };
}
