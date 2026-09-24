import Link from "next/link";
import { getCurrentAffiliate } from "@/application/services/affiliate-auth-service";
import { tokoo Brand } from "@/app/_components/tokoo -brand";

export default async function AffiliateLayout({ children }: { children: React.ReactNode }) {
  const affiliate = await getCurrentAffiliate();

  return (
    <div className="min-h-screen bg-slate-50 text-navy-900">
      <header className="border-b border-slate-200 bg-white lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <tokoo Brand href="/" />
          {affiliate?.status === "active" && <Link href="/dashboard" className="text-xs font-semibold text-slate-600">Dashboard marchand</Link>}
        </div>
      </header>
      <div className="flex min-h-screen">
        <aside className="hidden w-[248px] shrink-0 flex-col bg-navy-900 px-3 py-5 lg:flex">
          <div className="mb-7 px-2"><tokoo Brand href="/" dark /></div>
          <div className="mb-3 px-2 text-[10px] font-bold uppercase tracking-[.16em] text-white/35">Espace affilié</div>
          {affiliate?.status === "active" ? (
            <nav className="flex flex-1 flex-col gap-1">
              {(
                [
                  ["/affiliate/dashboard", "Tableau de bord"],
                  ["/affiliate/dashboard/links", "Mes liens"],
                  ["/affiliate/dashboard/payouts", "Paiements"],
                  ["/affiliate/dashboard/telegram", "Telegram"],
                ] as const
              ).map(([href, label]) => (
                <Link key={href} href={href} className="rounded-xl px-3 py-2.5 text-sm font-medium text-white/65 transition hover:bg-white/5 hover:text-white">{label}</Link>
              ))}
              <div className="mt-auto border-t border-white/10 pt-3">
                <Link href="/dashboard" className="rounded-xl px-3 py-2.5 text-sm font-medium text-primary hover:bg-primary/10">← Dashboard marchand</Link>
              </div>
            </nav>
          ) : (
            <nav className="flex flex-1 flex-col gap-1">
              <Link href="/affiliate/apply" className="rounded-xl bg-primary/15 px-3 py-2.5 text-sm font-semibold text-white">Devenir affilié</Link>
              <Link href="/" className="mt-auto rounded-xl px-3 py-2.5 text-sm font-medium text-white/55 hover:text-white">← Retour à tokoo </Link>
            </nav>
          )}
        </aside>
        <main className="min-w-0 flex-1 px-3 py-5 sm:px-6 sm:py-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
