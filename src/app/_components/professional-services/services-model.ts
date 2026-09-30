import type { ServiceSummary, TestimonialSummary, TeamMember } from "@/application/services/landing-config-service";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { sectionHeading, sectionSubheading, type StorefrontHighlight } from "@/application/config/storefront-blueprint";
import { STOREFRONT_PATHS, servicePath } from "@/application/config/storefront-routes";
import { toSafeHref } from "@/lib/safe-url";
import { resolveCtaTarget } from "../landing-sections/cta-target";
import { getHoursEntries, summarizeHours, type HoursEntry } from "../sector-shared/business-hours";
import { resolveAccentTheme, type AccentTheme } from "../sector-shared/accent-theme";
import { averageRating } from "../sector-shared/rating";
import { getPhoneHref } from "../sector-shared/phone";

/**
 * ============================================================
 * MODÈLE DE LA PAGE D'ACCUEIL — PRESTATAIRE DE SERVICE
 * ============================================================
 *
 * Même principe que le template restaurant (`restaurant/restaurant-model.ts`) :
 * toute la décision ici, en fonctions pures ; les composants React ne font
 * que dessiner ce que ce modèle leur donne.
 *
 * Deux différences volontaires avec l'ancien template qu'il remplace
 * (`ProfessionalServicesHome` dans `sector-home.tsx`) :
 *
 *  1. « Domaines d'intervention » n'utilise plus les catégories PRODUITS
 *     (`categories`, comptées par `productCount`) — une prestataire de
 *     service sans aucun produit voyait toujours 0 domaine et retombait sur
 *     un contenu d'exemple. Les domaines sont ici calculés à partir du champ
 *     `categoryName` des services eux-mêmes : le compte affiché est le vrai
 *     nombre de prestations dans ce domaine.
 *  2. L'équipe n'affiche plus `member.role` tel quel : ce champ est le RÔLE
 *     D'ACCÈS INTERNE au tableau de bord (owner, admin, cashier, employee…),
 *     pas un intitulé de poste. L'afficher tel quel montrerait « cashier »
 *     ou « owner » à un visiteur. Faute d'un intitulé de poste réel dans les
 *     données, on affiche seulement le nom.
 */

export const SHOW_DEMO_CONTENT = true;

const DEMO_SERVICES = [
  { name: "Consultation initiale", price: 50000, durationMinutes: 60, description: "Un premier échange pour cadrer votre besoin et les prochaines étapes." },
  { name: "Accompagnement personnalisé", price: 85000, durationMinutes: 90, description: "Une prestation structurée autour de vos objectifs et de vos contraintes." },
  { name: "Intervention sur mesure", price: 120000, durationMinutes: 120, description: "Une prestation adaptée à votre contexte, cadrée avant de démarrer." },
];
const DEMO_TESTIMONIALS = [
  { id: "demo-1", author: "Client exemple", content: "Une démarche claire, des échanges structurés et un vrai suivi du dossier.", rating: null },
  { id: "demo-2", author: "Cliente exemple", content: "J'ai rapidement compris l'offre et la prochaine étape à prendre.", rating: null },
  { id: "demo-3", author: "Client exemple", content: "Un interlocuteur clairement identifié du début à la fin.", rating: null },
];

// ------------------------------------------------------------
// Types de sortie
// ------------------------------------------------------------

export interface CtaAction {
  label: string;
  href: string;
  kind: "internal" | "external" | "protocol";
}

export type DockItem =
  | { kind: "address"; text: string }
  | { kind: "hours" }
  | { kind: "phone"; text: string; href: string }
  | { kind: "email"; text: string; href: string }
  | { kind: "whatsapp"; href: string };

export interface OfferingView {
  id: string;
  name: string;
  description: string | null;
  price: number;
  durationLabel: string | null;
  href: string;
}

export interface DomainView {
  name: string;
  countLabel: string;
}

export interface TeamMemberView {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface QuoteView {
  id: string;
  author: string;
  content: string;
  rating: number | null;
}

export type ReservationChannel = "online" | "whatsapp" | "phone" | "email";

export interface ProfessionalServicesHomeModel {
  theme: AccentTheme | null;
  hero: {
    title: string;
    isLongTitle: boolean;
    lead: string | null;
    imageUrl: string | null;
    primary: CtaAction | null;
    secondary: CtaAction | null;
    rating: { average: number; count: number } | null;
    trust: StorefrontHighlight[];
  };
  dock: DockItem[];
  hours: HoursEntry[];
  hoursSummary: string | null;
  offerings: {
    heading: string;
    subheading: string | null;
    items: OfferingView[];
    isDemo: boolean;
    catalogHref: string | null;
  } | null;
  domains: { heading: string; items: DomainView[] } | null;
  about: { heading: string; text: string } | null;
  team: { heading: string; items: TeamMemberView[] } | null;
  testimonials: { heading: string; items: QuoteView[]; isDemo: boolean; rating: { average: number; count: number } | null } | null;
  visit: {
    heading: string;
    lead: string | null;
    action: CtaAction | null;
    locationHeading: string;
    address: string | null;
    phone: { text: string; href: string } | null;
    email: { text: string; href: string } | null;
    whatsappHref: string | null;
  } | null;
}

// ------------------------------------------------------------
// Fonctions pures (exportées pour les tests)
// ------------------------------------------------------------

function toCtaAction(label: string, href: string): CtaAction {
  const kind = href.startsWith("http") ? "external" : /^[a-z][a-z0-9+.-]*:/i.test(href) ? "protocol" : "internal";
  return { label, href, kind };
}

/** Adresse email → `mailto:`, ou `null` si la valeur saisie n'a pas la forme d'une adresse. */
export function getEmailHref(email: string | null | undefined): string | null {
  const trimmed = (email ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? `mailto:${trimmed}` : null;
}

/**
 * Boutons du hero. Même ordre de repli que le hero générique et le template
 * restaurant : lien saisi par le commerçant, puis page recommandée par le
 * secteur, puis WhatsApp, puis email, puis téléphone.
 */
export function resolveActions(site: StorefrontSite): { primary: CtaAction | null; secondary: CtaAction | null } {
  const { config, blueprint, tenant, whatsappHref } = site;

  const primaryHref =
    toSafeHref(config.ctaUrl) ??
    resolveCtaTarget(blueprint.primaryCtaTarget, site) ??
    whatsappHref ??
    getEmailHref(tenant.email) ??
    getPhoneHref(tenant.phone) ??
    resolveCtaTarget("contact", site);

  const primary = primaryHref
    ? toCtaAction(
        config.ctaLabel?.trim() ||
          (primaryHref.startsWith("mailto:") ? "Écrire par email" : primaryHref.startsWith("tel:") ? "Appeler" : blueprint.primaryCtaLabel),
        primaryHref,
      )
    : null;

  const secondaryHref = toSafeHref(config.secondaryCtaUrl) ?? resolveCtaTarget(blueprint.secondaryCtaTarget, site);
  const secondary =
    secondaryHref && secondaryHref !== primaryHref
      ? toCtaAction(config.secondaryCtaLabel?.trim() || blueprint.secondaryCtaLabel, secondaryHref)
      : null;

  return { primary, secondary };
}

/** Comment le visiteur peut réellement joindre l'entreprise, d'après le bouton principal résolu. `null` si le bouton mène ailleurs (lien du commerçant, page contact). */
export function reservationChannel(primary: CtaAction | null, whatsappHref: string | null): ReservationChannel | null {
  if (!primary) return null;
  if (primary.href === STOREFRONT_PATHS.booking) return "online";
  if (whatsappHref && primary.href === whatsappHref) return "whatsapp";
  if (primary.href.startsWith("mailto:")) return "email";
  if (primary.href.startsWith("tel:")) return "phone";
  return null;
}

const CHANNEL_LEAD: Record<ReservationChannel, string> = {
  online: "Demandez votre rendez-vous en ligne.",
  whatsapp: "Écrivez-nous sur WhatsApp, on vous répond rapidement.",
  email: "Écrivez-nous par email, on vous répond rapidement.",
  phone: "Appelez-nous directement.",
};

/** Sous-titre par défaut du hero : purement fonctionnel. Sans rien de vrai à dire, on ne dit rien. */
export function defaultHeroLead(canReserve: boolean, hasServicesLink: boolean): string | null {
  if (canReserve && hasServicesLink) return "Demandez un rendez-vous ou consultez nos services.";
  if (canReserve) return "Demandez un rendez-vous.";
  if (hasServicesLink) return "Consultez nos services.";
  return null;
}

function durationLabel(minutes: number | null): string | null {
  if (!minutes) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest}` : `${hours} h`;
}

function toOfferingView(service: ServiceSummary): OfferingView {
  return {
    id: service.id,
    name: service.name,
    description: service.description?.trim() || null,
    price: service.price,
    durationLabel: durationLabel(service.durationMinutes),
    href: servicePath(service.slug),
  };
}

/**
 * Domaines d'intervention, calculés à partir des VRAIS services (leur champ
 * `categoryName`) plutôt que des catégories produit — voir la note en tête
 * de fichier. Triés comme la page /services (alphabétique français, les
 * services sans domaine regroupés en dernier), pour que l'ordre affiché ici
 * corresponde à ce que le visiteur retrouve en cliquant.
 */
export function buildDomains(services: ServiceSummary[]): DomainView[] {
  const counts = new Map<string, number>();
  for (const service of services) {
    const name = service.categoryName?.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "fr"))
    .map(([name, count]) => ({ name, countLabel: `${count} ${count > 1 ? "prestations" : "prestation"}` }));
}

// ------------------------------------------------------------
// Assemblage
// ------------------------------------------------------------

export interface ProfessionalServicesHomeInput {
  site: StorefrontSite;
  services: ServiceSummary[];
  testimonials: TestimonialSummary[];
  team: TeamMember[];
}

export function buildProfessionalServicesHomeModel({ site, services, testimonials, team }: ProfessionalServicesHomeInput): ProfessionalServicesHomeModel {
  const { tenant, config, blueprint, capabilities, whatsappHref } = site;
  const isBlank = services.length === 0 && testimonials.length === 0 && team.length === 0;

  const heroImage = site.heroMediaUrl ?? services.find((s) => s.imageUrl)?.imageUrl ?? tenant.bannerUrl ?? null;

  const description = tenant.description?.trim() || null;
  const { primary, secondary } = resolveActions(site);
  const channel = reservationChannel(primary, whatsappHref ?? null);
  const lead =
    config.heroSubtitle?.trim() ||
    (description && description.length <= 200 ? description : null) ||
    defaultHeroLead(channel !== null, secondary?.href === STOREFRONT_PATHS.services);
  const aboutText = description && description !== lead ? description : null;

  const title = config.heroTitle?.trim() || tenant.name;

  const hours = getHoursEntries(tenant.openingHours);
  const address = tenant.address?.trim() || null;
  const phoneHref = getPhoneHref(tenant.phone);
  const phone = tenant.phone && phoneHref ? { text: tenant.phone.trim(), href: phoneHref } : null;
  const emailHref = getEmailHref(tenant.email);
  const email = tenant.email && emailHref ? { text: tenant.email.trim(), href: emailHref } : null;

  const dock: DockItem[] = [];
  if (address) dock.push({ kind: "address", text: address });
  if (hours.length > 0) dock.push({ kind: "hours" });
  if (phone) dock.push({ kind: "phone", ...phone });
  else if (email) dock.push({ kind: "email", ...email });
  else if (whatsappHref) dock.push({ kind: "whatsapp", href: whatsappHref });

  const realOfferings = services.map(toOfferingView).slice(0, 6);
  const showDemoOfferings = SHOW_DEMO_CONTENT && services.length === 0;
  const demoOfferings: OfferingView[] = DEMO_SERVICES.map((s, i) => ({
    id: `demo-${i}`,
    name: s.name,
    description: s.description,
    price: s.price,
    durationLabel: durationLabel(s.durationMinutes),
    href: STOREFRONT_PATHS.services,
  }));
  const offeringItems = realOfferings.length > 0 ? realOfferings : showDemoOfferings ? demoOfferings : [];

  const domains = buildDomains(services);

  const realQuotes: QuoteView[] = testimonials.slice(0, 6).map((t) => ({ id: t.id, author: t.authorName, content: t.content, rating: t.rating }));
  const rating = averageRating(testimonials);
  const showDemoQuotes = SHOW_DEMO_CONTENT && realQuotes.length === 0;

  const teamItems: TeamMemberView[] = team.slice(0, 4).map((m) => ({ id: m.userId, name: m.fullName?.trim() || tenant.name, avatarUrl: m.avatarUrl }));

  const visitLead = channel ? CHANNEL_LEAD[channel] : null;
  const hasVisit = Boolean(primary) || hours.length > 0 || Boolean(address) || Boolean(phone) || Boolean(email);

  return {
    theme: resolveAccentTheme(site.accent?.primary),
    hero: {
      title,
      isLongTitle: title.length > 30,
      lead,
      imageUrl: heroImage,
      primary,
      secondary,
      rating,
      trust: site.highlights.slice(0, 3),
    },
    dock: dock.slice(0, 3),
    hours,
    hoursSummary: summarizeHours(hours),
    offerings:
      offeringItems.length > 0
        ? {
            heading: sectionHeading(blueprint, "services", "Nos services"),
            subheading: sectionSubheading(blueprint, "services"),
            items: offeringItems,
            isDemo: realOfferings.length === 0,
            catalogHref: capabilities.hasServices ? STOREFRONT_PATHS.services : null,
          }
        : null,
    domains: domains.length > 0 ? { heading: sectionHeading(blueprint, "categories", "Domaines d'intervention"), items: domains } : null,
    about: aboutText ? { heading: sectionHeading(blueprint, "about", "Notre approche"), text: aboutText } : null,
    team: teamItems.length > 0 ? { heading: sectionHeading(blueprint, "team", "L'équipe"), items: teamItems } : null,
    testimonials:
      realQuotes.length > 0 || showDemoQuotes
        ? {
            heading: sectionHeading(blueprint, "testimonials", "Ils nous font confiance"),
            items: realQuotes.length > 0 ? realQuotes : DEMO_TESTIMONIALS,
            isDemo: realQuotes.length === 0,
            rating,
          }
        : null,
    visit: hasVisit
      ? {
          heading: sectionHeading(blueprint, "booking", "Demander un rendez-vous"),
          lead: visitLead,
          action: primary,
          locationHeading: blueprint.headings.location ?? "Nous joindre",
          address,
          phone,
          email,
          whatsappHref: whatsappHref ?? null,
        }
      : null,
  };
}
