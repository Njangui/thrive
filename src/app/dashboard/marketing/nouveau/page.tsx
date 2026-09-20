import { redirect } from "next/navigation";
import { requireCurrentOrganization, requireMembership } from "@/application/services/auth-service";
import { getActiveProducts } from "@/application/services/catalog-service";
import { listOmnichannelPublicationTargets, publishOmnichannel } from "@/application/services/omnichannel-publication-service";
import { listCatalogVideos } from "@/application/services/catalog-video-service";
import { AppError } from "@/lib/errors";
import { OmnichannelPublicationComposer } from "../omnichannel-publication-composer";

// Une publication vidéo relit le fichier chez Zernio puis le téléverse chez
// Telegram/YouTube : plus long que la limite par défaut d'une fonction.
export const maxDuration = 60;

export default async function NewPublicationPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { organizationId } = await requireCurrentOrganization();
  const { error } = await searchParams;
  const [products, targets, videos] = await Promise.all([getActiveProducts(organizationId, 60), listOmnichannelPublicationTargets(organizationId), listCatalogVideos(organizationId, { limit: 30 })]);

  async function publishAction(formData: FormData) {
    "use server";
    const membership = await requireMembership(organizationId, ["owner", "admin", "manager", "sales"]);
    const productIds = String(formData.get("productIds") ?? "").split(",").map((v) => v.trim()).filter(Boolean);
    const targetIds = String(formData.get("targetIds") ?? "").split(",").map((v) => v.trim()).filter(Boolean);
    const currentTargets = await listOmnichannelPublicationTargets(organizationId);
    const selectedTargets = currentTargets.filter((target) => targetIds.includes(target.id));
    const manualTelegram = String(formData.get("telegramManualChatId") ?? "").trim();
    if (manualTelegram) selectedTargets.push({ id: `telegram:${manualTelegram}`, type: "telegram", platform: "telegram", label: `Telegram · ${manualTelegram}`, accountId: manualTelegram, available: true });

    // Destination capturée, redirect() appelé APRÈS le try/catch : redirect() lève NEXT_REDIRECT,
    // que le catch interceptait (une publication réussie affichait « NEXT_REDIRECT » comme erreur).
    let redirectTo: string;
    try {
      const result = await publishOmnichannel({
        organizationId,
        actorUserId: membership.userId,
        productIds,
        content: String(formData.get("content") ?? "") || null,
        mediaUrls: String(formData.get("mediaUrl") ?? "").trim() ? [String(formData.get("mediaUrl") ?? "").trim()] : undefined,
        mediaType: (String(formData.get("mediaType") ?? "image") as "image" | "video"),
        targets: selectedTargets,
        scheduledFor: String(formData.get("scheduledFor") ?? "") || null,
      });
      const status = result.scheduled ? "scheduled" : "published";
      redirectTo = `/dashboard/marketing?success=${status}&count=${result.published + result.scheduled}&failed=${result.failed.length}`;
    } catch (err) {
      const message = err instanceof AppError ? err.message : err instanceof Error ? err.message : "Impossible de créer la publication.";
      redirectTo = `/dashboard/marketing/nouveau?error=${encodeURIComponent(message)}`;
    }
    redirect(redirectTo);
  }

  return <div className="cresyva-page">
    <header className="cresyva-page-hero">
      <div><p className="cresyva-eyebrow">Marketing · Publication omnicanale</p><h1 className="mt-2 font-jakarta text-2xl font-extrabold tracking-tight sm:text-3xl">Publiez une fois. Diffusez partout.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-white/65">Sélectionnez un ou plusieurs produits de votre catalogue, choisissez vos canaux connectés, puis publiez immédiatement ou programmez la diffusion.</p></div>
      <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/75">{targets.filter((t) => t.available).length} destination(s) disponible(s)</div>
    </header>
    {error ? <div className="adm-alert-danger">{error}</div> : null}
    {!products.length ? <section className="cresyva-info-panel"><p className="font-semibold text-navy-900">Votre catalogue actif est vide.</p><p className="mt-1 text-sm text-slate-500">Ajoutez au moins un produit actif avant de lancer une publication omnicanale.</p><a href="/dashboard/products/new" className="mt-4 inline-flex adm-btn-primary">Ajouter un produit</a></section> : !targets.some((t) => t.available) ? <section className="cresyva-info-panel"><p className="font-semibold text-navy-900">Aucun canal de publication n&apos;est disponible.</p><p className="mt-1 text-sm text-slate-500">Connectez un réseau social, Telegram ou un groupe WhatsApp activé dans Canaux.</p><a href="/dashboard/channels" className="mt-4 inline-flex adm-btn-primary">Configurer mes canaux</a></section> : <section className="cresyva-product-card p-5 sm:p-7"><OmnichannelPublicationComposer action={publishAction} products={products} targets={targets} videos={videos} /></section>}
  </div>;
}
