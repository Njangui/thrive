import type { StorefrontSite } from "@/application/services/storefront-service";
import { sectionHeading } from "@/application/config/storefront-blueprint";
import { toSafeHref } from "@/lib/safe-url";
import { IconClock, IconMail, IconPhone, IconPin, IconWhatsapp } from "../storefront/storefront-icons";
import { Section, SectionHeading } from "../storefront/storefront-ui";

const DAY_ORDER = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

/**
 * `google.com/maps/search?api=1` : format d'URL publique documenté par
 * Google, sans clé d'API (contrairement à l'API Maps Embed) — le lien
 * fonctionne réellement, ce n'est pas un bouton décoratif.
 */
export function buildGoogleMapsSearchUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function ContactDetails({ site }: { site: StorefrontSite }) {
  const { tenant } = site;
  const hoursEntries = DAY_ORDER.filter((day) => tenant.openingHours[day]).map(
    (day) => [day, tenant.openingHours[day]!] as const,
  );

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="rounded-brand border border-black/[0.08] bg-white p-5">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-black/50">Nous joindre</h3>
        <ul className="mt-3 flex flex-col gap-3 text-sm">
          {tenant.address && (
            <li className="flex items-start gap-3">
              <IconPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <a
                href={buildGoogleMapsSearchUrl(tenant.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-brand hover:underline"
              >
                {tenant.address}
              </a>
            </li>
          )}
          {tenant.phone && (
            <li className="flex items-start gap-3">
              <IconPhone className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <a href={`tel:${tenant.phone.replace(/\s/g, "")}`} className="hover:text-brand hover:underline">
                {tenant.phone}
              </a>
            </li>
          )}
          {tenant.email && (
            <li className="flex items-start gap-3">
              <IconMail className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <a href={`mailto:${tenant.email}`} className="break-all hover:text-brand hover:underline">
                {tenant.email}
              </a>
            </li>
          )}
          {site.whatsappHref && (
            <li className="flex items-start gap-3">
              <IconWhatsapp className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <a
                href={site.whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-brand hover:underline"
              >
                Écrire sur WhatsApp
              </a>
            </li>
          )}
        </ul>
      </div>

      {hoursEntries.length > 0 && (
        <div className="rounded-brand border border-black/[0.08] bg-white p-5">
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide text-black/50">
            <IconClock className="h-4 w-4 text-brand" />
            Horaires
          </h3>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {hoursEntries.map(([day, range]) => (
              <li key={day} className="flex items-baseline justify-between gap-3">
                <span className="capitalize">{day}</span>
                <span className="text-black/55">{range}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ContactSection({ site }: { site: StorefrontSite }) {
  const { capabilities, blueprint } = site;
  if (!capabilities.hasContactDetails && !capabilities.hasOpeningHours) return null;

  return (
    <Section id="contact" tone="muted">
      <SectionHeading title={sectionHeading(blueprint, "contact", "Informations pratiques")} />
      <ContactDetails site={site} />
    </Section>
  );
}

/** Variante « adresse seule », activable indépendamment du bloc contact complet. */
export function LocationSection({ site }: { site: StorefrontSite }) {
  const { tenant, blueprint } = site;
  if (!tenant.address) return null;

  return (
    <Section>
      <SectionHeading title={sectionHeading(blueprint, "location", "Nous trouver")} />
      <div className="rounded-brand border border-black/[0.08] bg-white p-5">
        <p className="text-base">{tenant.address}</p>
        <a
          href={buildGoogleMapsSearchUrl(tenant.address)}
          target="_blank"
          rel="noopener noreferrer"
          className="sf-btn-outline mt-4 inline-flex h-10 items-center px-4 text-sm"
        >
          Ouvrir dans Google Maps
        </a>
      </div>
    </Section>
  );
}

export function SocialLinksSection({ site }: { site: StorefrontSite }) {
  const entries = Object.entries(site.tenant.socialLinks)
    .map(([platform, url]) => ({ platform, href: toSafeHref(url) }))
    .filter((entry): entry is { platform: string; href: string } => Boolean(entry.href));

  if (entries.length === 0) return null;

  return (
    <Section>
      <SectionHeading title="Suivez-nous" align="center" />
      <div className="flex flex-wrap justify-center gap-2">
        {entries.map((entry) => (
          <a
            key={entry.platform}
            href={entry.href}
            target="_blank"
            rel="noopener noreferrer me"
            className="sf-btn-outline inline-flex h-11 items-center px-5 text-sm capitalize"
          >
            {entry.platform}
          </a>
        ))}
      </div>
    </Section>
  );
}
