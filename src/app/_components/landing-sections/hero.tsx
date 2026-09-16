import type { TenantContext } from "@/infrastructure/tenant/resolve-request-tenant";
import { buildWhatsAppLink } from "@/infrastructure/tenant/resolve-request-tenant";
import { TrackedCtaLink } from "../tracked-cta-link";
import type { LandingConfig } from "@/application/services/landing-config-service";

/**
 * Reprend le contenu de l'ancien en-tête fixe de `tenant-landing.tsx`
 * (avant Lot K) — la seule différence est que c'est maintenant une
 * section parmi d'autres, activable/désactivable/réordonnable. Ne montre
 * volontairement PAS `tenant.description` en entier ici (garder le hero
 * percutant) : le texte long relève de la section "about" dédiée.
 */
export function HeroSection({ tenant, config }: { tenant: TenantContext; config: Pick<LandingConfig, "heroTitle" | "heroSubtitle" | "ctaLabel" | "ctaUrl" | "visualStyle"> }) {
  const whatsappHref = tenant.whatsappNumber
    ? buildWhatsAppLink(tenant.whatsappNumber, `Bonjour ${tenant.name}, je viens de votre site.`)
    : null;
  const ctaHref = config.ctaUrl || whatsappHref;
  const styleClass = config.visualStyle === "bold" ? "tenant-hero-bold" : config.visualStyle === "clean" ? "tenant-hero-clean" : "tenant-hero-soft";

  return (
    <section className={`tenant-hero ${styleClass} flex flex-col gap-5`}>
      {tenant.bannerUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={tenant.bannerUrl}
          alt=""
          className="-mx-5 aspect-[3/1] w-[calc(100%+2.5rem)] rounded-lg object-cover sm:-mx-0 sm:w-full"
        />
      )}
      {tenant.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={tenant.logoUrl} alt={tenant.name} className="h-12 w-auto object-contain" />
      )}
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-brand">{tenant.industry ?? "Entreprise"}</p>
        <h1 className="mt-2 max-w-3xl font-display text-4xl font-extrabold tracking-tight sm:text-6xl">{config.heroTitle || tenant.name}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600 sm:text-base">{config.heroSubtitle || tenant.description || `Découvrez les produits et services de ${tenant.name}.`}</p>
      </div>
      {ctaHref && (
        <TrackedCtaLink
          href={ctaHref}
          organizationId={tenant.organizationId}
          ctaId="whatsapp_landing"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-2 rounded-brand bg-leaf px-5 py-3 font-medium text-white transition-opacity hover:opacity-90"
        >
          {config.ctaLabel || "Nous contacter"}
        </TrackedCtaLink>
      )}
    </section>
  );
}
