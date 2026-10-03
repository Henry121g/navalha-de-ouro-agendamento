import { describe, expect, it, vi } from "vitest";
import { processOutboxRow, type OutboxDeps, type OutboxRow } from "./outbox";

function fakeAdmin(status = "confirmed") {
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const booking = {
    status,
    starts_at: "2026-10-05T12:00:00Z",
    price_cents: 4500,
    client_id: "cliente-1",
    services: { name: "Corte" },
    professionals: { display_name: "Carlos" },
    profiles: { full_name: "Ana" },
    shops: { timezone: "America/Sao_Paulo" },
  };
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: booking }),
  };
  const admin = {
    rpc,
    from: () => chain,
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "ana@exemplo.test" } } }) } },
  };
  return { admin, rpc };
}

const row: OutboxRow = { id: 42, booking_id: "b-1", kind: "reminder_24h" };

function deps(admin: unknown, extra: Partial<OutboxDeps> = {}): OutboxDeps {
  return {
    admin: admin as OutboxDeps["admin"],
    siteUrl: "https://exemplo.test",
    from: "Teste <onboarding@resend.dev>",
    resendApiKey: "re_teste",
    ...extra,
  };
}

describe("processOutboxRow", () => {
  it("envia com Idempotency-Key estável por item e marca como enviado", async () => {
    const { admin, rpc } = fakeAdmin();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
    const r = await processOutboxRow(row, deps(admin, { fetchImpl }));

    expect(r.status).toBe("sent");
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers["Idempotency-Key"]).toBe("barbearia-outbox-42");
    expect(JSON.parse(init.body).to).toEqual(["ana@exemplo.test"]);
    expect(rpc).toHaveBeenCalledWith("finish_outbox", expect.objectContaining({ p_status: "sent", p_provider_message_id: "msg_1" }));
  });

  it("descarta lembrete de agendamento cancelado sem chamar o provedor", async () => {
    const { admin, rpc } = fakeAdmin("cancelled");
    const fetchImpl = vi.fn();
    const r = await processOutboxRow(row, deps(admin, { fetchImpl }));
    expect(r.status).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("finish_outbox", expect.objectContaining({ p_status: "skipped" }));
  });

  it("sem RESEND_API_KEY, registra como não enviado (modo demonstração)", async () => {
    const { admin } = fakeAdmin();
    const fetchImpl = vi.fn();
    const r = await processOutboxRow(row, deps(admin, { fetchImpl, resendApiKey: undefined }));
    expect(r.status).toBe("skipped");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("usa o destinatário de teste quando configurado (restrição do domínio resend.dev)", async () => {
    const { admin } = fakeAdmin();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "m" }), { status: 200 }));
    await processOutboxRow(row, deps(admin, { fetchImpl, testRecipient: "dono@exemplo.test" }));
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).to).toEqual(["dono@exemplo.test"]);
  });

  it("erro temporário do provedor devolve o item para nova tentativa", async () => {
    const { admin, rpc } = fakeAdmin();
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 503 }));
    const r = await processOutboxRow(row, deps(admin, { fetchImpl }));
    expect(r.status).toBe("failed");
    expect(rpc).toHaveBeenCalledWith("finish_outbox", expect.objectContaining({ p_status: "pending" }));
  });

  it("erro permanente (ex.: 403 do domínio de teste) marca como falha", async () => {
    const { admin, rpc } = fakeAdmin();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ message: "You can only send testing emails to your own email address" }), { status: 403 }));
    await processOutboxRow(row, deps(admin, { fetchImpl }));
    expect(rpc).toHaveBeenCalledWith("finish_outbox", expect.objectContaining({ p_status: "failed" }));
  });
});
