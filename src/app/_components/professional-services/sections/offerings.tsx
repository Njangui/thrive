import Link from "next/link";
import type { ProfessionalServicesHomeModel } from "../services-model";
import { MenuLine, Price, SectionHead } from "../services-ui";

/**
 * Services phares. Pas de photo (contrairement aux plats du restaurant) :
 * `ServiceSummary` ne porte pas systématiquement d'image, et une prestation
 * de conseil n'a pas de photo « attendue » comme un plat en a une. La carte
 * met donc en avant le nom, la durée et le prix — ce qu'un visiteur compare
 * réellement avant de prendre rendez-vous.
 */
export function OfferingsSection({ offerings }: { offerings: NonNullable<ProfessionalServicesHomeModel["offerings"]> }) {
  return (
    <section className="ps-section" aria-labelledby="ps-offerings-title">
      <div className="ps-wrap">
        <SectionHead
          id="ps-offerings-title"
          title={offerings.heading}
          subtitle={offerings.subheading}
          badge={offerings.isDemo ? "Exemple" : null}
          action={offerings.catalogHref ? { label: "Tous nos services", href: offerings.catalogHref } : null}
        />
        <ul className="ps-offerings">
          {offerings.items.map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="ps-offering">
                <MenuLine label={item.name} value={<Price amount={item.price} />} />
                <span className="ps-offering__meta">
                  {item.durationLabel && <span className="ps-offering__duration">{item.durationLabel}</span>}
                  {item.description && <span className="ps-offering__desc">{item.description}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
