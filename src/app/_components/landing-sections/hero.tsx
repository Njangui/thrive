import type { TenantContext } from "@/infrastructure/tenant/resolve-request-tenant";
import { buildWhatsAppLink } from "@/infrastructure/tenant/resolve-request-tenant";
import { TrackedCtaLink } from "../tracked-cta-link";

/**
 * Reprend le contenu de l'ancien en-tête fixe de `tenant-landing.tsx`
 * (avant Lot K) — la seule différence est que c'est maintenant une
 * section parmi d'autres, activable/désactivable/réordonnable. Ne montre
 * volontairement PAS `tenant.description` en entier ici (garder le hero
 * percutant) : le texte long relève de la section "about" dédiée.
 */
export function HeroSection({ tenant }: { tenant: TenantContext }) {
  const whatsappHref = tenant.whatsappNumber
    ? buildWhatsAppLink(tenant.whatsappNumber, `Bonjour ${tenant.name}, je viens de votre site.`)
    : null;

  return (
    <section className="flex flex-col gap-4">
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
        <p className="text-sm font-medium text-brand">{tenant.industry ?? "Boutique"}</p>
        <h1 className="mt-1 font-display text-3xl font-bold tracking-tight sm:text-4xl">{tenant.name}</h1>
      </div>
      {whatsappHref && (
        <TrackedCtaLink
          href={whatsappHref}
          organizationId={tenant.organizationId}
          ctaId="whatsapp_landing"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex w-fit items-center gap-2 rounded-brand bg-leaf px-5 py-3 font-medium text-white transition-opacity hover:opacity-90"
        >
          Discuter sur WhatsApp
        </TrackedCtaLink>
      )}
    </section>
  );
}
