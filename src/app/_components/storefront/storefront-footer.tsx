import Link from "next/link";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { PAYMENT_METHOD_LABELS } from "@/domain/entities/landing";
import { env } from "@/lib/env";
import { toSafeHref } from "@/lib/safe-url";
import { PaymentBadge, IconMail, IconPhone, IconPin } from "./storefront-icons";
import { Container } from "./storefront-ui";

const SOCIAL_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  twitter: "X (Twitter)",
  x: "X (Twitter)",
  youtube: "YouTube",
  whatsapp: "WhatsApp",
};

const DAY_ORDER = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

/**
 * Pied de page du site vitrine. Remplace l'ancien pied de page de deux
 * lignes centrées, qui ne donnait aucune des informations qu'un visiteur
 * cherche à cet endroit précis : comment joindre l'entreprise, où elle se
 * trouve, quand elle est ouverte, comment payer.
 *
 * Toujours rendu, jamais désactivable (règle héritée du Lot K :
 * cohérence de marque). En revanche chaque COLONNE disparaît si elle n'a
 * rien à afficher — un pied de page à quatre colonnes dont trois sont
 * vides est pire que deux colonnes pleines.
 */
export function StorefrontFooter({ site }: { site: StorefrontSite }) {
  const { tenant, nav, capabilities, paymentMethods, foundedYear } = site;
  const currentYear = new Date().getFullYear();

  const socialEntries = Object.entries(tenant.socialLinks)
    .map(([platform, url]) => ({ platform, href: toSafeHref(url) }))
    .filter((entry): entry is { platform: string; href: string } => Boolean(entry.href));

  const hoursEntries = DAY_ORDER.filter((day) => tenant.openingHours[day]).map(
    (day) => [day, tenant.openingHours[day]!] as const,
  );

  // « Accueil » n'a pas d'intérêt dans un pied de page : le logo de
  // l'en-tête y mène déjà, et la place est comptée.
  const footerNav = nav.filter((entry) => entry.key !== "home");

  return (
    <footer className="sf-footer mt-auto border-t border-black/[0.07] bg-white">
      <Container className="grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4 lg:py-14">
        <div className="flex flex-col gap-3">
          {tenant.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- logo pouvant être hébergé hors de nos domaines autorisés
            <img src={tenant.logoUrl} alt={tenant.name} className="h-10 w-auto max-w-[170px] object-contain" />
          ) : (
            <p className="font-display text-lg font-extrabold tracking-tight">{tenant.name}</p>
          )}
          {tenant.description && (
            <p className="max-w-xs text-sm leading-6 text-black/60 line-clamp-4">{tenant.description}</p>
          )}
          {socialEntries.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-2">
              {socialEntries.map((entry) => (
                <li key={entry.platform}>
                  <a
                    href={entry.href}
                    target="_blank"
                    rel="noopener noreferrer me"
                    className="inline-flex rounded-brand border border-black/10 px-3 py-1.5 text-xs font-medium hover:border-brand hover:text-brand"
                  >
                    {SOCIAL_LABELS[entry.platform.toLowerCase()] ?? entry.platform}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        {footerNav.length > 0 && (
          <div>
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-black/50">Navigation</h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {footerNav.map((entry) => (
                <li key={entry.key}>
                  <Link href={entry.href} className="text-black/70 hover:text-brand hover:underline">
                    {entry.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(capabilities.hasContactDetails || hoursEntries.length > 0) && (
          <div>
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-black/50">Informations</h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm text-black/70">
              {tenant.address && (
                <li className="flex items-start gap-2">
                  <IconPin className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                  <span>{tenant.address}</span>
                </li>
              )}
              {tenant.phone && (
                <li className="flex items-start gap-2">
                  <IconPhone className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                  {/* `tel:` sans espaces : un numéro formaté « +237 6XX XXX XXX » n'est pas composable tel quel par tous les navigateurs mobiles. */}
                  <a href={`tel:${tenant.phone.replace(/\s/g, "")}`} className="hover:text-brand hover:underline">
                    {tenant.phone}
                  </a>
                </li>
              )}
              {tenant.email && (
                <li className="flex items-start gap-2">
                  <IconMail className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                  <a href={`mailto:${tenant.email}`} className="break-all hover:text-brand hover:underline">
                    {tenant.email}
                  </a>
                </li>
              )}
            </ul>
          </div>
        )}

        {hoursEntries.length > 0 && (
          <div>
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-black/50">Horaires</h2>
            <ul className="mt-3 flex flex-col gap-1.5 text-sm text-black/70">
              {hoursEntries.map(([day, range]) => (
                <li key={day} className="flex items-baseline justify-between gap-3">
                  <span className="capitalize">{day}</span>
                  <span className="text-black/50">{range}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Container>

      {paymentMethods.length > 0 && (
        <div className="border-t border-black/[0.06]">
          <Container className="flex flex-wrap items-center gap-3 py-5 text-black/60">
            <span className="text-xs font-semibold uppercase tracking-wide">Moyens de paiement acceptés</span>
            <div className="flex flex-wrap gap-2">
              {paymentMethods.map((method) => (
                <PaymentBadge key={method} method={method} label={PAYMENT_METHOD_LABELS[method]} />
              ))}
            </div>
          </Container>
        </div>
      )}

      <div className="border-t border-black/[0.06]">
        <Container className="flex flex-col gap-3 py-5 text-xs text-black/50 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {foundedYear && foundedYear < currentYear ? `${foundedYear}–${currentYear}` : currentYear} {tenant.name}.
            Tous droits réservés.
          </p>
          {!capabilities.brandingRemoved && (
            <p>
              Site propulsé par{" "}
              <a href={env.NEXT_PUBLIC_APP_URL} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-brand">
                CRESYVA
              </a>
            </p>
          )}
        </Container>
      </div>
    </footer>
  );
}
