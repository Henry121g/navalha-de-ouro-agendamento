import type { Metadata } from "next";
import Link from "next/link";
import { safeNext } from "@/lib/safe-next";
import { signIn } from "../actions";
import { SignInForm } from "../auth-form";

export const metadata: Metadata = { title: "Entrar" };

export default async function SignInPage({ searchParams }: PageProps<"/entrar">) {
  const { proximo } = await searchParams;
  const next = safeNext(typeof proximo === "string" ? proximo : null);

  return (
    <div className="mx-auto max-w-sm">
      <h1 className="mb-6 text-2xl font-bold">Entrar</h1>
      <SignInForm action={signIn} next={next} />
      <p className="mt-6 text-sm">
        Não tem conta?{" "}
        <Link href="/cadastrar" className="font-semibold text-brand underline">
          Cadastre-se
        </Link>
      </p>
      <section aria-labelledby="demo" className="mt-8 rounded-xl border border-border bg-surface p-4 text-sm">
        <h2 id="demo" className="font-semibold">
          Contas de demonstração
        </h2>
        <p className="mt-1 text-muted">Senha de todas: <code>demo12345</code></p>
        <ul className="mt-2 list-inside list-disc">
          <li>Cliente: <code>cliente@demo.test</code></li>
          <li>Barbeiro: <code>barbeiro@demo.test</code></li>
          <li>Gerente (dados redefinidos diariamente): <code>gerente@demo.test</code></li>
        </ul>
      </section>
    </div>
  );
}
