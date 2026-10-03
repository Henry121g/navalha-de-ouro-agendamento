// Teste de concorrência contra um Supabase real (PGlite não tem conexões simultâneas).
// Dispara N reservas idênticas ao mesmo tempo, por N sessões de clientes diferentes, para o
// mesmo profissional e horário. Resultado esperado: exatamente 1 sucesso.
// Uso: node --env-file=.env.local scripts/concurrency-test.ts [N]
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const N = Number(process.argv[2] ?? 10);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !anonKey || !serviceKey) {
  console.error("Defina NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { db: { schema: "barbearia" }, auth: { persistSession: false } });
const CORTE = "00000000-0000-4000-8000-000000000101";

// Clientes temporários (removidos ao final).
const users: { id: string; email: string; password: string }[] = [];
for (let i = 0; i < N; i++) {
  const email = `concorrencia-${Date.now()}-${i}@demo.test`;
  const password = randomBytes(16).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { app: "barbearia", shop: "barbearia-demo", full_name: `Teste ${i}` },
  });
  if (error) throw error;
  users.push({ id: data.user.id, email, password });
}

try {
  const { data: pro } = await admin.from("professionals").select("id").eq("active", true).limit(1).single();
  if (!pro) throw new Error("Nenhum profissional ativo. Rode o seed.");

  // Primeiro horário livre daqui a 3+ dias.
  let slot: string | undefined;
  for (let d = 3; d < 14 && !slot; d++) {
    const day = new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
    const { data } = await admin.rpc("available_slots", { p_professional: pro.id, p_service: CORTE, p_day: day });
    slot = data?.[0]?.starts_at;
  }
  if (!slot) throw new Error("Nenhum horário livre encontrado.");

  const sessions = await Promise.all(
    users.map(async (u) => {
      const c = createClient(url, anonKey, { db: { schema: "barbearia" }, auth: { persistSession: false } });
      const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
      if (error) throw error;
      return c;
    }),
  );

  console.log(`Disparando ${N} reservas simultâneas para ${slot}…`);
  const results = await Promise.all(
    sessions.map((c) =>
      c.rpc("book_appointment", { p_professional: pro.id, p_service: CORTE, p_start: slot, p_reschedule_from: null }),
    ),
  );
  const ok = results.filter((r) => !r.error).length;
  const conflicts = results.filter((r) => r.error?.message.includes("HORARIO_INDISPONIVEL")).length;
  const other = results.filter((r) => r.error && !r.error.message.includes("HORARIO_INDISPONIVEL"));
  console.log(`Sucessos: ${ok} · Recusadas por conflito: ${conflicts} · Outros erros: ${other.length}`);
  other.forEach((r) => console.log("  -", r.error?.message));

  const { count } = await admin
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("professional_id", pro.id)
    .eq("starts_at", slot)
    .neq("status", "cancelled");
  console.log(`Reservas ativas no horário (banco): ${count}`);
  if (ok !== 1 || count !== 1 || other.length) {
    console.error("✗ FALHOU: esperado exatamente 1 reserva.");
    process.exitCode = 1;
  } else {
    console.log("✓ OK: exatamente 1 reserva, as demais recusadas.");
  }
} finally {
  const ids = users.map((u) => u.id);
  if (ids.length) await admin.from("bookings").delete().in("client_id", ids);
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
}
