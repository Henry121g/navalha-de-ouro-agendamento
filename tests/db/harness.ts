import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const root = join(__dirname, "..", "..");
const migrationsDir = join(root, "supabase", "migrations");

export const SHOP_TZ = "America/Sao_Paulo";

export type Role = "anon" | "authenticated" | "service_role";

export interface TestDb {
  db: PGlite;
  /** Executa `fn` como um usuário da API (RLS ativa), dentro de uma transação. */
  as<T>(uid: string | null, fn: (tx: Transaction) => Promise<T>, role?: Role): Promise<T>;
  createUser(fullName: string, role?: "admin" | "professional" | "client"): Promise<string>;
}

export async function createTestDb(): Promise<TestDb> {
  const db = await PGlite.create({ extensions: { btree_gist } });
  await db.exec(readFileSync(join(__dirname, "supabase-stub.sql"), "utf8"));
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
  await db.exec(readFileSync(join(root, "supabase", "seed.sql"), "utf8"));

  const as: TestDb["as"] = (uid, fn, role = uid ? "authenticated" : "anon") =>
    db.transaction(async (tx) => {
      await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? ""]);
      await tx.exec(`set local role ${role}`);
      return fn(tx);
    });

  let counter = 0;
  const createUser: TestDb["createUser"] = async (fullName, role = "client") => {
    counter += 1;
    const { rows } = await db.query<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data)
       values ($1, jsonb_build_object('app', 'barbearia', 'full_name', $2::text))
       returning id`,
      [`usuario${counter}@exemplo.test`, fullName],
    );
    const id = rows[0].id;
    if (role !== "client") {
      await db.query(`update barbearia.profiles set role = $2 where id = $1`, [id, role]);
    }
    if (role === "professional") {
      await db.query(
        `insert into barbearia.professionals (id, shop_id, display_name)
         select id, shop_id, full_name from barbearia.profiles where id = $1`,
        [id],
      );
    }
    return id;
  };

  return { db, as, createUser };
}

/** Data (AAAA-MM-DD) de uma segunda-feira daqui a pelo menos `minDays` dias, no fuso da barbearia. */
export function nextMonday(minDays = 3): string {
  const d = new Date(Date.now() + minDays * 86_400_000);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Converte data + hora local de São Paulo (UTC−3, sem horário de verão desde 2019) em ISO UTC. */
export function spLocal(date: string, time: string): string {
  return new Date(`${date}T${time}:00-03:00`).toISOString();
}
