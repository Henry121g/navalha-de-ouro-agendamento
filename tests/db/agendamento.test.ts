import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, nextMonday, spLocal, type TestDb } from "./harness";

const CORTE = "00000000-0000-4000-8000-000000000101"; // 30 min, R$ 45,00
const COMBO = "00000000-0000-4000-8000-000000000103"; // 60 min

let t: TestDb;
let admin: string, barbeiro: string, outroBarbeiro: string, ana: string, bruno: string;
const dia = nextMonday(3);

async function slots(uid: string | null, professional: string, service: string, day = dia) {
  return t.as(uid, async (tx) => {
    const { rows } = await tx.query<{ starts_at: Date }>(
      `select starts_at from barbearia.available_slots($1, $2, $3::date)`,
      [professional, service, day],
    );
    return rows.map((r) => new Date(r.starts_at).toISOString());
  });
}

async function book(uid: string, professional: string, service: string, start: string, from?: string) {
  return t.as(uid, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `select barbearia.book_appointment($1, $2, $3::timestamptz, $4) as id`,
      [professional, service, start, from ?? null],
    );
    return rows[0].id;
  });
}

beforeAll(async () => {
  t = await createTestDb();
  admin = await t.createUser("Dona Admin", "admin");
  barbeiro = await t.createUser("Carlos Barbeiro", "professional");
  outroBarbeiro = await t.createUser("Diego Barbeiro", "professional");
  ana = await t.createUser("Ana Cliente");
  bruno = await t.createUser("Bruno Cliente");
  for (const p of [barbeiro, outroBarbeiro]) {
    await t.db.query(
      `insert into barbearia.professional_services (professional_id, service_id)
       select $1, id from barbearia.services`,
      [p],
    );
    // Segunda a sábado, 09:00–18:00 (hora local)
    await t.db.query(
      `insert into barbearia.working_hours (professional_id, weekday, start_time, end_time)
       select $1, d, '09:00', '18:00' from generate_series(1, 6) d`,
      [p],
    );
  }
});

describe("cadastro", () => {
  it("cria perfil de cliente para cadastros do app e ignora o papel enviado nos metadados", async () => {
    const { rows } = await t.db.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data)
       values ('invasor@exemplo.test', '{"app":"barbearia","full_name":"Invasor","role":"admin"}')
       returning id`,
    );
    const perfil = await t.db.query<{ role: string }>(
      `select role from barbearia.profiles where id = $1`,
      [rows[0].id],
    );
    expect(perfil.rows[0].role).toBe("client");
  });

  it("não cria perfil para cadastros de outros apps do mesmo projeto Supabase", async () => {
    const { rows } = await t.db.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data)
       values ('erp@exemplo.test', '{"app":"erp","full_name":"Usuário ERP"}') returning id`,
    );
    const perfil = await t.db.query(`select 1 from barbearia.profiles where id = $1`, [rows[0].id]);
    expect(perfil.rows).toHaveLength(0);
  });
});

describe("disponibilidade e fuso horário", () => {
  it("gera horários dentro do expediente local convertidos para UTC", async () => {
    const lista = await slots(ana, barbeiro, CORTE);
    expect(lista[0]).toBe(spLocal(dia, "09:00")); // 12:00 UTC
    expect(lista.at(-1)).toBe(spLocal(dia, "17:30")); // último corte de 30 min termina às 18:00
    expect(lista).toHaveLength(35); // 09:00..17:30 em passos de 15 min (8,5 h × 4 + 1)
  });

  it("não oferece horários no domingo (sem expediente)", async () => {
    const domingo = new Date(`${dia}T12:00:00Z`);
    domingo.setUTCDate(domingo.getUTCDate() - 1);
    expect(await slots(ana, barbeiro, CORTE, domingo.toISOString().slice(0, 10))).toEqual([]);
  });

  it("respeita bloqueios do profissional", async () => {
    await t.db.query(
      `insert into barbearia.time_off (professional_id, period, reason)
       values ($1, tstzrange($2::timestamptz, $3::timestamptz, '[)'), 'Almoço')`,
      [outroBarbeiro, spLocal(dia, "12:00"), spLocal(dia, "13:00")],
    );
    const lista = await slots(ana, outroBarbeiro, CORTE);
    expect(lista).not.toContain(spLocal(dia, "12:00"));
    expect(lista).not.toContain(spLocal(dia, "11:45")); // terminaria 12:15, dentro do bloqueio
    expect(lista).toContain(spLocal(dia, "11:30")); // termina exatamente 12:00
    expect(lista).toContain(spLocal(dia, "13:00"));
  });

  it("visitante anônimo consulta horários sem ver dados de clientes", async () => {
    expect((await slots(null, barbeiro, CORTE)).length).toBeGreaterThan(0);
    await expect(
      t.as(null, (tx) => tx.query(`select * from barbearia.bookings`)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("agendamento", () => {
  it("reserva um horário livre com preço congelado e enfileira confirmação e lembrete", async () => {
    const id = await book(ana, barbeiro, CORTE, spLocal(dia, "10:00"));
    const { rows } = await t.db.query<{ price_cents: number; kinds: string[] }>(
      `select b.price_cents, array_agg(o.kind order by o.kind) as kinds
       from barbearia.bookings b join barbearia.notification_outbox o on o.booking_id = b.id
       where b.id = $1 group by b.price_cents`,
      [id],
    );
    expect(rows[0].price_cents).toBe(4500);
    expect(rows[0].kinds).toEqual(["confirmation", "reminder_24h"]);
    expect(await slots(bruno, barbeiro, CORTE)).not.toContain(spLocal(dia, "10:00"));
  });

  it("recusa horário sobreposto, mas aceita horário adjacente (intervalo semiaberto)", async () => {
    await expect(book(bruno, barbeiro, CORTE, spLocal(dia, "10:15"))).rejects.toThrow(
      /HORARIO_INDISPONIVEL/,
    );
    await expect(book(bruno, barbeiro, CORTE, spLocal(dia, "10:30"))).resolves.toBeTruthy();
  });

  it("a restrição de exclusão barra sobreposição mesmo inserindo direto no banco", async () => {
    await expect(
      t.db.query(
        `insert into barbearia.bookings (shop_id, professional_id, client_id, service_id, period, price_cents)
         select shop_id, $1, $2, $3, tstzrange($4::timestamptz, $5::timestamptz, '[)'), 4500
         from barbearia.profiles where id = $2`,
        [barbeiro, bruno, CORTE, spLocal(dia, "10:10"), spLocal(dia, "10:40")],
      ),
    ).rejects.toThrow(/bookings_no_overlap/);
  });

  it("recusa horário fora da grade, fora do expediente ou no passado", async () => {
    await expect(book(ana, barbeiro, CORTE, spLocal(dia, "11:07"))).rejects.toThrow(/HORARIO_INDISPONIVEL/);
    await expect(book(ana, barbeiro, COMBO, spLocal(dia, "17:30"))).rejects.toThrow(/HORARIO_INDISPONIVEL/);
    const ontem = new Date(Date.now() - 86_400_000).toISOString();
    await expect(book(ana, barbeiro, CORTE, ontem)).rejects.toThrow(/HORARIO_INDISPONIVEL/);
  });

  it("clientes não inserem nem alteram agendamentos diretamente", async () => {
    await expect(
      t.as(ana, (tx) => tx.query(`update barbearia.bookings set price_cents = 0`)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("cancelamento e reagendamento", () => {
  it("cliente cancela dentro do prazo e o horário volta a ficar livre", async () => {
    const id = await book(ana, barbeiro, CORTE, spLocal(dia, "14:00"));
    await t.as(ana, (tx) => tx.query(`select barbearia.cancel_booking($1, 'Imprevisto')`, [id]));
    expect(await slots(bruno, barbeiro, CORTE)).toContain(spLocal(dia, "14:00"));
  });

  it("cliente não cancela a menos de 2 h do início; o admin pode", async () => {
    // Agendamento a 1 h do início, inserido diretamente (simula a passagem do tempo).
    const inicio = new Date(Date.now() + 3_600_000);
    inicio.setUTCSeconds(0, 0);
    const { rows } = await t.db.query<{ id: string }>(
      `insert into barbearia.bookings (shop_id, professional_id, client_id, service_id, period, price_cents)
       select shop_id, $1, $2, $3, tstzrange($4::timestamptz, $4::timestamptz + interval '30 minutes', '[)'), 4500
       from barbearia.profiles where id = $2 returning id`,
      [outroBarbeiro, ana, CORTE, inicio.toISOString()],
    );
    const id = rows[0].id;
    await expect(
      t.as(ana, (tx) => tx.query(`select barbearia.cancel_booking($1)`, [id])),
    ).rejects.toThrow(/PRAZO_CANCELAMENTO_EXPIRADO/);
    await t.as(admin, (tx) => tx.query(`select barbearia.cancel_booking($1, 'Barbeiro doente')`, [id]));
  });

  it("outro cliente não cancela nem descobre agendamentos alheios", async () => {
    const id = await book(ana, barbeiro, CORTE, spLocal(dia, "15:00"));
    await expect(
      t.as(bruno, (tx) => tx.query(`select barbearia.cancel_booking($1)`, [id])),
    ).rejects.toThrow(/AGENDAMENTO_INEXISTENTE/);
  });

  it("reagendamento que falha mantém o agendamento original", async () => {
    const original = await book(ana, barbeiro, CORTE, spLocal(dia, "16:00"));
    await book(bruno, barbeiro, CORTE, spLocal(dia, "16:30"));
    await expect(book(ana, barbeiro, CORTE, spLocal(dia, "16:30"), original)).rejects.toThrow(
      /HORARIO_INDISPONIVEL/,
    );
    const { rows } = await t.db.query<{ status: string }>(
      `select status from barbearia.bookings where id = $1`,
      [original],
    );
    expect(rows[0].status).toBe("confirmed");
  });

  it("reagendamento bem-sucedido cancela o antigo e liga o novo a ele", async () => {
    const original = await book(ana, barbeiro, CORTE, spLocal(dia, "09:00"));
    // Novo horário sobrepõe o antigo: só é possível porque o antigo é cancelado na mesma transação.
    const novo = await book(ana, barbeiro, CORTE, spLocal(dia, "09:15"), original);
    const { rows } = await t.db.query<{ id: string; status: string; rescheduled_from: string | null }>(
      `select id, status, rescheduled_from from barbearia.bookings where id in ($1, $2)`,
      [original, novo],
    );
    expect(rows.find((r) => r.id === original)?.status).toBe("cancelled");
    expect(rows.find((r) => r.id === novo)?.rescheduled_from).toBe(original);
  });
});

describe("isolamento de dados (RLS)", () => {
  it("cliente vê apenas os próprios agendamentos", async () => {
    const ids = await t.as(bruno, async (tx) => {
      const { rows } = await tx.query<{ client_id: string }>(`select client_id from barbearia.bookings`);
      return new Set(rows.map((r) => r.client_id));
    });
    expect([...ids]).toEqual([bruno]);
  });

  it("profissional vê só a própria agenda; admin vê todos", async () => {
    const doBarbeiro = await t.as(outroBarbeiro, async (tx) => {
      const { rows } = await tx.query<{ professional_id: string }>(
        `select professional_id from barbearia.bookings`,
      );
      return new Set(rows.map((r) => r.professional_id));
    });
    expect([...doBarbeiro]).toEqual([outroBarbeiro]);

    const total = await t.db.query<{ n: number }>(`select count(*)::int as n from barbearia.bookings`);
    const doAdmin = await t.as(admin, async (tx) => {
      const { rows } = await tx.query<{ n: number }>(`select count(*)::int as n from barbearia.bookings`);
      return rows[0].n;
    });
    expect(doAdmin).toBe(total.rows[0].n);
  });

  it("cliente não promove o próprio papel", async () => {
    await expect(
      t.as(ana, (tx) => tx.query(`update barbearia.profiles set role = 'admin' where id = $1`, [ana])),
    ).rejects.toThrow(/permission denied/);
  });

  it("cliente não altera serviços nem o expediente de profissionais", async () => {
    const r = await t.as(ana, (tx) =>
      tx.query(`update barbearia.services set price_cents = 1 returning id`),
    );
    expect(r.rows).toHaveLength(0);
    const w = await t.as(ana, (tx) =>
      tx.query(`delete from barbearia.working_hours returning id`),
    );
    expect(w.rows).toHaveLength(0);
  });

  it("usuário de outro app não enxerga perfis da barbearia", async () => {
    const { rows } = await t.db.query<{ id: string }>(
      `select id from auth.users where email = 'erp@exemplo.test'`,
    );
    const perfis = await t.as(rows[0].id, (tx) => tx.query(`select id from barbearia.profiles`));
    expect(perfis.rows).toHaveLength(0);
  });

  it("indicadores do painel são exclusivos do admin", async () => {
    const de = spLocal(dia, "00:00");
    const ate = new Date(new Date(de).getTime() + 86_400_000).toISOString();
    await expect(
      t.as(ana, (tx) => tx.query(`select * from barbearia.dashboard_metrics($1, $2)`, [de, ate])),
    ).rejects.toThrow(/SEM_PERMISSAO/);
    const m = await t.as(admin, async (tx) => {
      const { rows } = await tx.query<{ total_bookings: number; expected_revenue_cents: number }>(
        `select * from barbearia.dashboard_metrics($1, $2)`,
        [de, ate],
      );
      return rows[0];
    });
    expect(Number(m.total_bookings)).toBeGreaterThan(0);
    expect(Number(m.expected_revenue_cents) % 500).toBe(0);
  });
});

describe("bloqueios de agenda", () => {
  const addTimeOff = (uid: string, professional: string, start = "08:00", end = "09:00") =>
    t.as(uid, (tx) =>
      tx.query<{ id: string }>(`select barbearia.add_time_off($1, $2::date, $3::time, $4::time, 'Teste') as id`, [
        professional,
        dia,
        start,
        end,
      ]),
    );

  it("profissional bloqueia a própria agenda com conversão de fuso", async () => {
    const r = await addTimeOff(barbeiro, barbeiro);
    const { rows } = await t.db.query<{ inicio: Date }>(
      `select lower(period) as inicio from barbearia.time_off where id = $1`,
      [r.rows[0].id],
    );
    expect(new Date(rows[0].inicio).toISOString()).toBe(spLocal(dia, "08:00"));
  });

  it("profissional não bloqueia a agenda de outro, e cliente não bloqueia nenhuma", async () => {
    await expect(addTimeOff(barbeiro, outroBarbeiro)).rejects.toThrow(/row-level security/);
    await expect(addTimeOff(ana, barbeiro)).rejects.toThrow(/row-level security/);
  });

  it("recusa intervalo invertido", async () => {
    await expect(addTimeOff(barbeiro, barbeiro, "10:00", "09:00")).rejects.toThrow(/INTERVALO_INVALIDO/);
  });

  it("expõe início e fim do agendamento como colunas derivadas", async () => {
    const { rows } = await t.db.query<{ ok: boolean }>(
      `select bool_and(starts_at = lower(period) and ends_at = upper(period)) as ok from barbearia.bookings`,
    );
    expect(rows[0].ok).toBe(true);
  });
});

describe("fila de e-mails sem duplicidade", () => {
  it("cada item é reivindicado uma única vez, mesmo com execuções repetidas", async () => {
    const claim = () =>
      t.as(
        null,
        async (tx) => (await tx.query<{ id: number }>(`select id from barbearia.claim_outbox(100)`)).rows,
        "service_role",
      );
    const primeira = await claim();
    const segunda = await claim();
    expect(primeira.length).toBeGreaterThan(0);
    expect(segunda).toHaveLength(0); // já estão "processing"; lembretes futuros não vencidos
    await expect(
      t.db.query(
        `insert into barbearia.notification_outbox (booking_id, kind)
         select booking_id, kind from barbearia.notification_outbox limit 1`,
      ),
    ).rejects.toThrow(/duplicate key/);
  });

  it("clientes não executam a fila", async () => {
    await expect(
      t.as(ana, (tx) => tx.query(`select barbearia.claim_outbox(10)`)),
    ).rejects.toThrow(/permission denied/);
  });
});
