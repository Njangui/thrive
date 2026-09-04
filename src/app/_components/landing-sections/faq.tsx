import type { FaqItem } from "@/application/services/landing-config-service";

/**
 * `<details>`/`<summary>` natif plutôt qu'un accordéon en Client
 * Component : zéro JS nécessaire, accessible par défaut (même esprit que
 * `TrackedCtaLink`, qui évite déjà tout tracker JS tiers côté vitrine
 * publique).
 */
export function FaqSection({ faqs }: { faqs: FaqItem[] }) {
  if (faqs.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-lg font-semibold">Questions fréquentes</h2>
      <div className="flex flex-col divide-y divide-ink/10 rounded-lg border border-ink/10 bg-white">
        {faqs.map((faq) => (
          <details key={faq.id} className="group p-4">
            <summary className="cursor-pointer list-none font-medium marker:content-none">
              <span className="flex items-center justify-between gap-2">
                {faq.question}
                <span className="text-muted transition-transform group-open:rotate-45">+</span>
              </span>
            </summary>
            <p className="mt-2 text-sm text-muted">{faq.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
