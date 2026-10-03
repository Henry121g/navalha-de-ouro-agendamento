// Cria/atualiza as contas de demonstração e redefine os dados fictícios.
// Uso: node --env-file=.env.local scripts/seed-demo.ts
// Idempotente: pode rodar várias vezes (também roda diariamente via GitHub Actions).
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  db: { schema: "barbearia" },
  auth: { persistSession: false, autoRefreshToken: false },
});

const SHOP_ID = "00000000-0000-4000-8000-000000000001";
// Senha pública das contas listadas na tela de login (permissões limitadas à barbearia demo).
const PUBLIC_PASSWORD = "demo12345";

interface DemoUser {
  email: string;
  fullName: string;
  role: "admin" | "professional" | "client";
  public: boolean;
  bio?: string;
}

const USERS: DemoUser[] = [
  { email: "gerente@demo.test", fullName: "Marina Gerente", role: "admin", public: true },
  { email: "barbeiro@demo.test", fullName: "Carlos Navalha", role: "professional", public: true, bio: "Cortes clássicos e degradê." },
  { email: "barbeiro2@demo.test", fullName: "Diego Tesoura", role: "professional", public: false, bio: "Especialista em barba." },
  { email: "cliente@demo.test", fullName: "Ana Cliente", role: "client", public: true },
  { email: "bruno@demo.test", fullName: "Bruno Lima", role: "client", public: false },
  { email: "carla@demo.test", fullName: "Carla Souza", role: "client", public: false },
  { email: "davi@demo.test", fullName: "Davi Rocha", role: "client", public: false },
];

async function findUserId(email: string): Promise<string | null> {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((u) => u.email === email);
    if (found) return found.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

async function upsertUser(u: DemoUser): Promise<string> {
  const password = u.public ? PUBLIC_PASSWORD : randomBytes(18).toString("base64url");
  const metadata = { app: "barbearia", shop: "barbearia-demo", full_name: u.fullName };
  let id = await findUserId(u.email);
  if (id) {
    // Restaura a senha pública caso algum visitante a tenha alterado.
    const { error } = await admin.auth.admin.updateUserById(id, { password, user_metadata: metadata, email_confirm: true });
    if (error) throw error;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email,
      password,
      email_confirm: true,
      user_metadata: metadata, // o trigger cria o perfil de cliente
    });
    if (error) throw error;
    id = data.user.id;
  }

  const { error: profileError } = await admin
    .from("profiles")
    .upsert({ id, shop_id: SHOP_ID, role: u.role, full_name: u.fullName });
  if (profileError) throw profileError;

  if (u.role === "professional") {
    const { error } = await admin
      .from("professionals")
      .upsert({ id, shop_id: SHOP_ID, display_name: u.fullName, bio: u.bio ?? null, active: true });
    if (error) throw error;
  }
  return id;
}

for (const u of USERS) {
  await upsertUser(u);
  console.log(`✓ ${u.role.padEnd(12)} ${u.email}${u.public ? " (conta pública)" : ""}`);
}

const { data: count, error } = await admin.rpc("reset_demo_data");
if (error) throw error;
console.log(`✓ Dados de demonstração redefinidos: ${count} agendamentos fictícios.`);
