import Link from "next/link";
import { getCurrentAffiliate } from "@/application/services/affiliate-auth-service";

/**
 * Portail `/affiliate/*` — troisième persona du produit, distincte des
 * organisations tenant (`/dashboard`) et du Super Admin (`/admin`). Le
 * layout reste volontairement permissif (pas de redirect ici) : `/affiliate/apply`
 * doit rester accessible à un utilisateur qui n'a PAS encore de ligne
 * `affiliates` (c'est justement là qu'elle est créée) — chaque page fille
 * applique sa propre garde (`requireAffiliate()` pour le tableau de bord).
 */
export default async function AffiliateLayout({ children }: { children: React.ReactNode }) {
  const affiliate = await getCurrentAffiliate();

  return (
    <div className="min-h-screen bg-ink/[0.02]">
      <header className="border-b border-ink/10 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link href="/" className="font-display text-lg font-bold tracking-tight">
            SME-OS <span className="text-leaf">Affiliation</span>
          </Link>
          {affiliate?.status === "active" && (
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/affiliate/dashboard" className="text-ink/80 hover:text-ink">
                Tableau de bord
              </Link>
              <Link href="/affiliate/dashboard/links" className="text-ink/80 hover:text-ink">
                Mes liens
              </Link>
              <Link href="/affiliate/dashboard/payouts" className="text-ink/80 hover:text-ink">
                Paiements
              </Link>
              <Link href="/affiliate/dashboard/telegram" className="text-ink/80 hover:text-ink">
                Telegram
              </Link>
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
