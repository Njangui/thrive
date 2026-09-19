import { redirect } from "next/navigation";
import Link from "next/link";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import { listServicesForOrg, toggleServiceStatus } from "@/application/services/service-service";
import { AppError } from "@/lib/errors";

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  active: "Actif",
  inactive: "Inactif",
};

/**
 * CORRECTIF (chantier catalogue V2, 0056) — cette page écrivait jusqu'ici
 * via service-catalog-service.ts (formulaire intégré, suppression
 * définitive) tandis que /dashboard/services/new et
 * /dashboard/services/[id]/edit écrivaient via service-service.ts, sans
 * aucun lien entre les deux écrans — voir l'en-tête de
 * service-catalog-service.ts pour le détail. Cette page est désormais une
 * liste pure (comme /dashboard/products), qui pointe vers ces deux écrans
 * plutôt que de dupliquer un chemin d'écriture concurrent.
 */
async function toggleServiceStatusAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);
  const serviceId = String(formData.get("serviceId") ?? "");
  const currentStatus = String(formData.get("currentStatus") ?? "");

  try {
    await toggleServiceStatus(serviceId, organizationId, currentStatus === "active" ? "inactive" : "active");
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la mise à jour";
    redirect(`/dashboard/services?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/services");
}

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  const services = await listServicesForOrg(organizationId);

  const activeCount = services.filter((s) => s.status === "active").length;
  const draftCount = services.filter((s) => s.status === "draft").length;

  return (
    <div className="cresyva-page products-page flex min-w-0 flex-col gap-6">
      <header className="cresyva-page-hero">
        <div className="relative z-10 flex min-w-0 flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="cresyva-eyebrow">Vitrine · catalogue · rendez-vous</p>
            <h1 className="mt-2 max-w-3xl font-jakarta text-3xl font-extrabold tracking-tight sm:text-4xl">Vos prestations, présentées comme elles le méritent.</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/65">Une seule fiche prestation alimente votre site, WhatsApp et l&apos;assistant IA — photo, description et informations complémentaires incluses.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/services/new" className="cresyva-btn-primary">+ Ajouter une prestation</Link>
          </div>
        </div>
      </header>

      <section className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-3">
        {[
          ["Total prestations", services.length, "Enregistrées"],
          ["Actives", activeCount, "Visibles sur votre vitrine"],
          ["Brouillons", draftCount, "Pas encore publiées"],
        ].map(([label, value, help]) => (
          <div key={String(label)} className="cresyva-kpi">
            <p className="adm-label">{label}</p>
            <p className="mt-1 font-jakarta text-2xl font-extrabold tracking-tight text-navy-900">{value}</p>
            <p className="mt-1 text-xs adm-muted">{help}</p>
          </div>
        ))}
      </section>

      {error && <p className="adm-alert-danger">{error}</p>}
      {success && <p className="adm-alert-success">{success}</p>}

      <section className="cresyva-info-panel">
        <div>
          <p className="cresyva-eyebrow text-primary">Une fiche, plusieurs usages</p>
          <h2 className="mt-1 font-jakarta text-base font-bold">Photos, description, informations complémentaires.</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Illustrez chaque prestation (coupe, consultation, réparation...) avec plusieurs photos et précisez tout ce qui aide le client à se décider (zone desservie, durée de validité, matériel utilisé...).</p>
        </div>
        <span className="cresyva-status">Catalogue connecté</span>
      </section>

      <section className="min-w-0">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-jakarta text-lg font-bold tracking-tight">Vos prestations</h2>
            <p className="mt-1 text-xs text-slate-500">Gérez la visibilité et les informations de chaque fiche.</p>
          </div>
          <span className="hidden text-xs font-medium text-slate-400 sm:block">{services.length} prestation{services.length > 1 ? "s" : ""}</span>
        </div>
        {services.length === 0 ? (
          <div className="cresyva-empty">
            <div className="cresyva-empty-icon">＋</div>
            <h3 className="font-jakarta text-base font-bold">Aucune prestation pour l&apos;instant</h3>
            <p className="mt-1 max-w-md text-sm text-slate-500">Ajoutez-en une pour qu&apos;elle apparaisse sur votre site et soit reconnue par l&apos;assistant WhatsApp.</p>
            <Link href="/dashboard/services/new" className="adm-btn-primary mt-4">Ajouter ma première prestation</Link>
          </div>
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {services.map((s) => {
              const isActive = s.status === "active";
              return (
                <article key={s.id} className="cresyva-product-card group">
                  <div className="relative aspect-[1.25/1] overflow-hidden bg-slate-100">
                    {s.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.imageUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                    ) : (
                      <div className="grid h-full place-items-center text-sm font-medium text-slate-400">Aucune image</div>
                    )}
                    <span className={`absolute left-3 top-3 ${isActive ? "adm-badge-success" : "adm-badge-neutral"}`}>{STATUS_LABELS[s.status] ?? s.status}</span>
                  </div>
                  <div className="flex min-w-0 flex-col p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-jakarta text-sm font-bold text-navy-900">{s.name}</p>
                        <p className="mt-1 truncate text-xs text-slate-500">{s.categoryName ?? "Sans catégorie"}</p>
                      </div>
                      <Link href={`/dashboard/services/${s.id}/edit`} className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:border-primary hover:text-primary">Modifier</Link>
                    </div>
                    <div className="mt-4 flex items-end justify-between gap-3 border-t border-slate-100 pt-3">
                      <div>
                        <p className="font-jakarta text-base font-extrabold text-navy-900">{s.price.toLocaleString("fr-FR")} FCFA</p>
                        <p className="mt-1 text-xs font-medium text-slate-500">{s.durationMinutes ? `${s.durationMinutes} min` : "Durée libre"}</p>
                      </div>
                      <form action={toggleServiceStatusAction}>
                        <input type="hidden" name="organizationId" value={organizationId} />
                        <input type="hidden" name="serviceId" value={s.id} />
                        <input type="hidden" name="currentStatus" value={s.status} />
                        <button type="submit" className="text-xs font-medium text-violet-600 hover:underline">
                          {isActive ? "Désactiver" : "Activer"}
                        </button>
                      </form>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
