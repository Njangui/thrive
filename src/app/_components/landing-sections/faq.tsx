import Link from "next/link";
import type { FaqItem } from "@/application/services/landing-config-service";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { STOREFRONT_PATHS } from "@/application/config/storefront-routes";
import { sectionHeading } from "@/application/config/storefront-blueprint";
import { Section, SectionHeading } from "../storefront/storefront-ui";

/**
 * `<details>`/`<summary>` natif plutôt qu'un accordéon en composant
 * client : zéro JavaScript, accessible par défaut, et — point important
 * pour le référencement — le contenu des réponses est présent dans le
 * HTML servi, donc indexable, ce qui n'est pas le cas d'un accordéon
 * monté côté navigateur.
 */
export function FaqList({ faqs }: { faqs: FaqItem[] }) {
  return (
    <div className="divide-y divide-black/[0.07] overflow-hidden rounded-brand border border-black/[0.08] bg-white">
      {faqs.map((faq) => (
        <details key={faq.id} className="group px-5 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium marker:content-none">
            {faq.question}
            <span aria-hidden className="shrink-0 text-xl leading-none text-black/35 transition-transform group-open:rotate-45">
              +
            </span>
          </summary>
          <p className="mt-3 whitespace-pre-line text-sm leading-6 text-black/60">{faq.answer}</p>
        </details>
      ))}
    </div>
  );
}

export function FaqSection({ faqs, site }: { faqs: FaqItem[]; site: StorefrontSite }) {
  if (faqs.length === 0) return null;
  const shown = faqs.slice(0, 6);

  return (
    <Section>
      <SectionHeading
        title={sectionHeading(site.blueprint, "faq", "Questions fréquentes")}
        action={faqs.length > shown.length ? { label: "Toutes les questions", href: STOREFRONT_PATHS.faq } : undefined}
      />
      <div className="max-w-3xl">
        <FaqList faqs={shown} />
        {faqs.length > shown.length && (
          <Link href={STOREFRONT_PATHS.faq} className="mt-4 inline-flex text-sm font-semibold text-brand hover:underline">
            Voir les {faqs.length} questions
          </Link>
        )}
      </div>
    </Section>
  );
}
