import Link from "next/link";
import { requireViewer } from "@/lib/auth";

export default async function PanelLayout({ children }: LayoutProps<"/painel">) {
  const viewer = await requireViewer("/painel", ["admin", "professional"]);
  const link = "rounded-md border border-border bg-surface px-3 py-1.5 hover:border-brand";
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Painel" className="flex flex-wrap gap-2 text-sm">
        <Link href="/painel" className={link}>
          Visão geral
        </Link>
        <Link href="/painel/agenda" className={link}>
          Expediente e bloqueios
        </Link>
        {viewer.role === "admin" && (
          <Link href="/painel/servicos" className={link}>
            Serviços
          </Link>
        )}
      </nav>
      {children}
    </div>
  );
}
