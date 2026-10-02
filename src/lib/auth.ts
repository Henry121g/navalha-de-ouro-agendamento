import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type Role = "admin" | "professional" | "client";

export interface Viewer {
  id: string;
  email: string | null;
  fullName: string;
  role: Role;
  shopId: string;
}

/** Usuário autenticado e seu perfil nesta barbearia (ou null). Validado no servidor via getClaims. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, role, shop_id")
    .eq("id", claims.sub)
    .maybeSingle();
  if (!profile) return null;
  return {
    id: profile.id,
    email: typeof claims.email === "string" ? claims.email : null,
    fullName: profile.full_name,
    role: profile.role as Role,
    shopId: profile.shop_id,
  };
});

export async function requireViewer(next: string, roles?: Role[]): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/entrar?proximo=${encodeURIComponent(next)}`);
  if (roles && !roles.includes(viewer.role)) redirect("/");
  return viewer;
}

export interface Shop {
  id: string;
  name: string;
  timezone: string;
  cancel_deadline: string;
}

export const getShop = cache(async (): Promise<Shop> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shops")
    .select("id, name, timezone, cancel_deadline")
    .eq("slug", "barbearia-demo")
    .single();
  if (error || !data) throw new Error("Barbearia de demonstração não encontrada. Rode o seed.");
  return data;
});
