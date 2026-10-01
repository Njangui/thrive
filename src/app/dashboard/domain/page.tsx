import { redirect } from "next/navigation";
import { requireCurrentOrganization, requireMembership } from "@/application/services/auth-service";
import { listActiveTldPricing, listMyDomainRequests, requestDomain } from "@/application/services/domain-service";
import { SubmitButton } from "@/app/_components/submit-button";
import { DomainSearchField } from "./domain-search-field";
import { AppError } from "@/lib/errors";

/**
 * Lot P — Domaine personnalisé, ouvert à TOUTES les offres (Discover
 * inclus) : ce n'est plus un avantage de plan, c'est un service à la
 * demande, acheté et configuré manuellement par notre équipe (aucun
 * registrar n'est branché automatiquement — voir docs/DEPLOYMENT.md).
 * Anciennement une section de /dashboard/site (verrouillée Starter+,
 * donc invisible pour Discover) ; déplacée ici pour rester accessible à
 * tous, sans dépendre de la personnalisation du site.
 */

const DOMAIN_STATUS_LABEL: Record<string, string> = {
  requested: "En attente de traitement",
  processing: "En cours de traitement",
  registered: "Enregistré",
  failed: "Échoué",
  cancelled: "Annulé",
};

async function requestDomainAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const domainName = String(formData.get("domainName") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);

  try {
    await requestDomain(organizationId, domainName, membership.userId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la demande de domaine";
    redirect(`/dashboard/domain?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/domain?success=" + encodeURIComponent("Votre demande de domaine a été transmise."));
}

export default async function DomainPage({ searchParams }: { searchParams: Promise<{ error?: string; success?: string }> }) {
  const { error, success } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  const [tldPricing, domainRequests] = await Promise.all([listActiveTldPricing(), listMyDomainRequests(organizationId)]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-jakarta text-2xl font-bold tracking-tight">Domaine personnalisé</h1>
        <p className="mt-1 text-sm text-slate-500">
          Votre boutique fonctionne déjà sur un sous-domaine gratuit (<code>votre-nom.{"{domaine}"}</code>). Un nom de
          domaine à vous (ex : <code>votre-boutique.cm</code>) est un service payant sur demande, hors forfait : nous
          l&apos;achetons et le configurons pour vous une fois votre demande traitée.
        </p>
      </div>

      {success && <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}
      {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <section className="adm-card flex flex-col gap-4">
        {tldPricing.length === 0 ? (
          <p className="text-sm text-slate-500">Aucune extension n&apos;est proposée à la vente pour le moment.</p>
        ) : (
          <>
            <form action={requestDomainAction} className="flex flex-col gap-2">
              <input type="hidden" name="organizationId" value={organizationId} />
              <DomainSearchField organizationId={organizationId} />
              <p className="text-xs text-slate-500">
                Extensions disponibles : {tldPricing.map((t) => `${t.tld} (${t.soldPriceFcfa.toLocaleString("fr-FR")} FCFA)`).join(", ")}
              </p>
              <div>
                <SubmitButton pendingLabel="Envoi..." className="adm-btn-primary disabled:opacity-60">Demander ce domaine</SubmitButton>
              </div>
            </form>

            {domainRequests.length > 0 && (
              <div className="border-t border-navy-900/10 pt-4">
                <h2 className="adm-heading-2 text-lg">Vos demandes</h2>
                <ul className="mt-3 flex flex-col gap-2">
                  {domainRequests.map((r) => (
                    <li key={r.id} className="flex items-center justify-between rounded-xl bg-[#F8FAFC] px-4 py-3 text-sm">
                      <span className="font-medium text-navy-900">{r.domainName}</span>
                      <span className="text-xs text-slate-500">{DOMAIN_STATUS_LABEL[r.status] ?? r.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
