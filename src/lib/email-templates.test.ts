import { describe, expect, it } from "vitest";
import { buildEmail, type EmailData } from "./email-templates";

const data: EmailData = {
  clientName: "Ana <script>",
  serviceName: "Corte masculino",
  professionalName: "Carlos",
  startsAt: "2026-10-05T12:00:00Z",
  priceCents: 4500,
  timeZone: "America/Sao_Paulo",
  siteUrl: "https://exemplo.test",
};

describe("modelos de e-mail", () => {
  it("mostra o horário no fuso da barbearia e o valor em reais", () => {
    const e = buildEmail("confirmation", data);
    expect(e.subject).toContain("09:00");
    expect(e.text).toContain("R$ 45,00");
  });

  it("escapa HTML de dados do usuário", () => {
    const e = buildEmail("reminder_24h", data);
    expect(e.html).not.toContain("<script>");
    expect(e.html).toContain("Ana &lt;script&gt;");
  });

  it("gera assuntos distintos por tipo", () => {
    const subjects = (["confirmation", "reminder_24h", "cancellation"] as const).map(
      (k) => buildEmail(k, data).subject,
    );
    expect(new Set(subjects).size).toBe(3);
  });
});
