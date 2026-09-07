import type { TenantContext } from "@/infrastructure/tenant/resolve-request-tenant";
import { buildWhatsAppLink } from "@/infrastructure/tenant/resolve-request-tenant";
import { TrackedCtaLink } from "../tracked-cta-link";

export function CtaSection({ tenant }: { tenant: TenantContext }) {
  if (!tenant.whatsappNumber) return null;

  const whatsappHref = buildWhatsAppLink(tenant.whatsappNumber, `Bonjour ${tenant.name}, j'ai une question.`);

  return (
    <section className="flex flex-col items-center gap-3 rounded-lg bg-brand px-6 py-10 text-center text-white">
      <h2 className="font-display text-xl font-semibold">Prêt·e à passer à l&apos;étape suivante ?</h2>
      <p className="max-w-md text-sm text-white/85">
        Écrivez-nous directement sur WhatsApp — nous répondons généralement rapidement.
      </p>
      <TrackedCtaLink
        href={whatsappHref}
        organizationId={tenant.organizationId}
        ctaId="whatsapp_cta"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 rounded-brand bg-white px-5 py-3 font-medium text-ink transition-opacity hover:opacity-90"
      >
        Discuter sur WhatsApp
      </TrackedCtaLink>
    </section>
  );
}
