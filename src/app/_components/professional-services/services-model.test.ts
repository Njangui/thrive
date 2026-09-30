import { describe, expect, it } from "vitest";
import type { ServiceSummary, TeamMember, TestimonialSummary } from "@/application/services/landing-config-service";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { getStorefrontBlueprint } from "@/application/config/storefront-blueprint";
import {
  buildDomains,
  buildProfessionalServicesHomeModel,
  defaultHeroLead,
  getEmailHref,
  reservationChannel,
  resolveActions,
} from "./services-model";

// ------------------------------------------------------------
// Fixtures : seuls les champs lus par le modèle sont renseignés.
// ------------------------------------------------------------

type SiteOverrides = {
  tenant?: Record<string, unknown>;
  config?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  whatsappHref?: string | null;
  heroMediaUrl?: string | null;
  highlights?: unknown[];
  accent?: { primary: string; secondary: string };
};

function makeSite(o: SiteOverrides = {}): StorefrontSite {
  return {
    tenant: { organizationId: "org-1", name: "Cabinet Fofana", description: null, bannerUrl: null, openingHours: {}, address: null, phone: null, email: null, ...o.tenant },
    config: { ctaUrl: null, ctaLabel: null, secondaryCtaUrl: null, secondaryCtaLabel: null, heroTitle: null, heroSubtitle: null, ...o.config },
    blueprint: getStorefrontBlueprint("professional_services"),
    capabilities: {
      hasServices: false,
      hasContactDetails: false,
      hasOpeningHours: false,
      hasWhatsApp: false,
      bookingEnabled: false,
      ...o.capabilities,
    },
    whatsappHref: o.whatsappHref ?? null,
    heroMediaUrl: o.heroMediaUrl ?? null,
    highlights: o.highlights ?? [],
    accent: o.accent ?? { primary: "#1D4ED8", secondary: "#0EA5E9" },
  } as unknown as StorefrontSite;
}

function makeService(n: number, overrides: Partial<ServiceSummary> = {}): ServiceSummary {
  return {
    id: `s${n}`,
    name: `Service ${n}`,
    slug: `service-${n}`,
    description: `Description ${n}`,
    price: 10000 * n,
    durationMinutes: 60,
    categoryName: null,
    imageUrl: null,
    ...overrides,
  };
}

const makeQuote = (n: number, rating: number | null): TestimonialSummary => ({
  id: `t${n}`,
  authorName: `Client ${n}`,
  content: `Avis ${n}`,
  rating,
  displayOrder: n,
});

const makeMember = (n: number, overrides: Partial<TeamMember> = {}): TeamMember => ({
  userId: `u${n}`,
  fullName: `Personne ${n}`,
  avatarUrl: null,
  role: "owner",
  ...overrides,
});

const emptyInput = { services: [], testimonials: [], team: [] };

// ------------------------------------------------------------
// Email
// ------------------------------------------------------------

describe("getEmailHref", () => {
  it("accepte une adresse plausible et rejette le reste", () => {
    expect(getEmailHref("contact@cabinet.cm")).toBe("mailto:contact@cabinet.cm");
    expect(getEmailHref(" contact@cabinet.cm ")).toBe("mailto:contact@cabinet.cm");
    expect(getEmailHref("pas une adresse")).toBeNull();
    expect(getEmailHref(null)).toBeNull();
  });
});

// ------------------------------------------------------------
// Domaines — calculés à partir des VRAIS services, pas des catégories produit
// ------------------------------------------------------------

describe("buildDomains", () => {
  it("regroupe et compte les services par categoryName réel", () => {
    const services = [
      makeService(1, { categoryName: "Conseil" }),
      makeService(2, { categoryName: "Conseil" }),
      makeService(3, { categoryName: "Audit" }),
    ];
    expect(buildDomains(services)).toEqual([
      { name: "Audit", countLabel: "1 prestation" },
      { name: "Conseil", countLabel: "2 prestations" },
    ]);
  });

  it("ignore les services sans domaine et n'invente rien", () => {
    expect(buildDomains([makeService(1, { categoryName: null }), makeService(2, { categoryName: "  " })])).toEqual([]);
    expect(buildDomains([])).toEqual([]);
  });

  it("trie par ordre alphabétique français", () => {
    const services = [makeService(1, { categoryName: "Économie" }), makeService(2, { categoryName: "Audit" })];
    expect(buildDomains(services).map((d) => d.name)).toEqual(["Audit", "Économie"]);
  });
});

// ------------------------------------------------------------
// Sous-titre par défaut
// ------------------------------------------------------------

describe("sous-titre par défaut du hero", () => {
  it("décrit uniquement ce que le visiteur peut faire ici", () => {
    expect(defaultHeroLead(true, true)).toBe("Demandez un rendez-vous ou consultez nos services.");
    expect(defaultHeroLead(true, false)).toBe("Demandez un rendez-vous.");
    expect(defaultHeroLead(false, true)).toBe("Consultez nos services.");
    expect(defaultHeroLead(false, false)).toBeNull();
  });
});

// ------------------------------------------------------------
// Boutons et canal de contact
// ------------------------------------------------------------

describe("resolveActions", () => {
  it("réserve en ligne quand l'offre l'inclut", () => {
    const site = makeSite({ capabilities: { bookingEnabled: true, hasServices: true } });
    const { primary, secondary } = resolveActions(site);
    expect(primary).toMatchObject({ href: "/rendez-vous", kind: "internal" });
    expect(secondary).toMatchObject({ href: "/services", kind: "internal" });
  });

  it("se replie sur WhatsApp, puis l'email, puis le téléphone", () => {
    const wa = resolveActions(makeSite({ whatsappHref: "https://wa.me/1" }));
    expect(wa.primary).toMatchObject({ href: "https://wa.me/1", kind: "external" });

    const email = resolveActions(makeSite({ tenant: { email: "contact@cabinet.cm" } }));
    expect(email.primary).toMatchObject({ href: "mailto:contact@cabinet.cm", kind: "protocol", label: "Écrire par email" });

    const tel = resolveActions(makeSite({ tenant: { phone: "+237 600 000 000" } }));
    expect(tel.primary).toMatchObject({ href: "tel:+237600000000", kind: "protocol", label: "Appeler" });
  });

  it("n'affiche aucun bouton quand aucune destination n'existe", () => {
    expect(resolveActions(makeSite())).toEqual({ primary: null, secondary: null });
  });

  it("respecte le lien et le libellé saisis par le commerçant", () => {
    const site = makeSite({ config: { ctaUrl: "https://exemple.cm/contact", ctaLabel: "Nous écrire" } });
    expect(resolveActions(site).primary).toEqual({ label: "Nous écrire", href: "https://exemple.cm/contact", kind: "external" });
  });
});

describe("reservationChannel", () => {
  it("reconnaît en ligne, WhatsApp, email et téléphone", () => {
    expect(reservationChannel({ label: "x", href: "/rendez-vous", kind: "internal" }, null)).toBe("online");
    expect(reservationChannel({ label: "x", href: "https://wa.me/1", kind: "external" }, "https://wa.me/1")).toBe("whatsapp");
    expect(reservationChannel({ label: "x", href: "mailto:a@b.cm", kind: "protocol" }, null)).toBe("email");
    expect(reservationChannel({ label: "x", href: "tel:+2376", kind: "protocol" }, null)).toBe("phone");
  });

  it("ne devine rien pour un lien du commerçant ou la page contact", () => {
    expect(reservationChannel({ label: "x", href: "https://autre.cm", kind: "external" }, "https://wa.me/1")).toBeNull();
    expect(reservationChannel({ label: "x", href: "/contact", kind: "internal" }, null)).toBeNull();
    expect(reservationChannel(null, null)).toBeNull();
  });
});

// ------------------------------------------------------------
// Page complète
// ------------------------------------------------------------

describe("buildProfessionalServicesHomeModel — commerce vierge", () => {
  const model = buildProfessionalServicesHomeModel({ site: makeSite(), ...emptyInput });

  it("montre des services et des avis d'exemple, clairement signalés", () => {
    expect(model.offerings?.isDemo).toBe(true);
    expect(model.offerings?.catalogHref).toBeNull();
    expect(model.testimonials?.isDemo).toBe(true);
    expect(model.testimonials?.rating).toBeNull();
  });

  it("ne montre ni domaines, ni équipe, ni à propos, ni bloc rendez-vous, ni bouton", () => {
    expect(model.domains).toBeNull();
    expect(model.team).toBeNull();
    expect(model.about).toBeNull();
    expect(model.visit).toBeNull();
    expect(model.hero.primary).toBeNull();
    expect(model.dock).toEqual([]);
  });

  it("titre le hero avec le nom réel de l'entreprise, sans photo imposée", () => {
    expect(model.hero.title).toBe("Cabinet Fofana");
    expect(model.hero.imageUrl).toBeNull();
  });
});

describe("buildProfessionalServicesHomeModel — domaines et catalogue de services", () => {
  it("n'invente pas de domaines à partir de services réels sans categoryName", () => {
    const model = buildProfessionalServicesHomeModel({
      site: makeSite({ capabilities: { hasServices: true } }),
      ...emptyInput,
      services: [makeService(1), makeService(2)],
    });
    expect(model.domains).toBeNull();
    expect(model.offerings?.isDemo).toBe(false);
    expect(model.offerings?.items).toHaveLength(2);
  });

  it("affiche les domaines réels avec leur vrai compte de services", () => {
    const model = buildProfessionalServicesHomeModel({
      site: makeSite({ capabilities: { hasServices: true } }),
      ...emptyInput,
      services: [makeService(1, { categoryName: "Conseil" }), makeService(2, { categoryName: "Conseil" }), makeService(3, { categoryName: "Audit" })],
    });
    expect(model.domains?.items).toEqual([
      { name: "Audit", countLabel: "1 prestation" },
      { name: "Conseil", countLabel: "2 prestations" },
    ]);
  });

  it("limite les services phares à 6 et pointe vers /services", () => {
    const model = buildProfessionalServicesHomeModel({
      site: makeSite({ capabilities: { hasServices: true } }),
      ...emptyInput,
      services: Array.from({ length: 9 }, (_, i) => makeService(i + 1)),
    });
    expect(model.offerings?.items).toHaveLength(6);
    expect(model.offerings?.catalogHref).toBe("/services");
    expect(model.offerings?.items[0]?.href).toBe("/services/service-1");
  });
});

describe("buildProfessionalServicesHomeModel — équipe", () => {
  it("n'affiche jamais le rôle d'accès interne (owner, cashier...) comme intitulé de poste", () => {
    const model = buildProfessionalServicesHomeModel({
      site: makeSite(),
      ...emptyInput,
      team: [makeMember(1, { fullName: "Awa Ndiaye", role: "cashier" }), makeMember(2, { fullName: "Boris Eto'o", role: "owner" })],
    });
    expect(model.team?.items).toEqual([
      { id: "u1", name: "Awa Ndiaye", avatarUrl: null },
      { id: "u2", name: "Boris Eto'o", avatarUrl: null },
    ]);
    const serialized = JSON.stringify(model.team);
    expect(serialized).not.toContain("cashier");
    expect(serialized).not.toContain("owner");
  });

  it("retombe sur le nom de l'entreprise si un membre n'a pas de nom renseigné", () => {
    const model = buildProfessionalServicesHomeModel({ site: makeSite(), ...emptyInput, team: [makeMember(1, { fullName: null })] });
    expect(model.team?.items[0]?.name).toBe("Cabinet Fofana");
  });

  it("ne montre pas d'équipe d'exemple : sans membre réel, la section n'existe pas", () => {
    const model = buildProfessionalServicesHomeModel({ site: makeSite(), ...emptyInput });
    expect(model.team).toBeNull();
  });
});

describe("buildProfessionalServicesHomeModel — à propos et hero", () => {
  it("ne répète pas la description : courte, elle sert de sous-titre ; longue, elle nourrit la section à propos", () => {
    const short = buildProfessionalServicesHomeModel({ site: makeSite({ tenant: { description: "Cabinet de conseil en stratégie, basé à Douala." } }), ...emptyInput });
    expect(short.hero.lead).toBe("Cabinet de conseil en stratégie, basé à Douala.");
    expect(short.about).toBeNull();

    const longText = "Nous accompagnons les PME depuis 2015. ".repeat(10);
    const long = buildProfessionalServicesHomeModel({ site: makeSite({ tenant: { description: longText } }), ...emptyInput });
    expect(long.hero.lead).not.toBe(longText.trim());
    expect(long.hero.lead).toBeNull();
    expect(long.about?.text).toBe(longText.trim());
  });

  it("réduit un nom d'entreprise très long", () => {
    const model = buildProfessionalServicesHomeModel({ site: makeSite({ tenant: { name: "Cabinet International de Conseil Fiscal et Juridique de Yaoundé" } }), ...emptyInput });
    expect(model.hero.isLongTitle).toBe(true);
  });

  it("compose la barre d'infos et annonce le canal de contact réel", () => {
    const model = buildProfessionalServicesHomeModel({
      site: makeSite({ tenant: { address: "Bastos, Yaoundé", email: "contact@cabinet.cm", openingHours: { lundi: "9:00 - 18:00" } } }),
      ...emptyInput,
    });
    expect(model.dock.map((d) => d.kind)).toEqual(["address", "hours", "email"]);
    expect(model.visit?.lead).toBe("Écrivez-nous par email, on vous répond rapidement.");
    expect(model.visit?.locationHeading).toBe("Nos bureaux");
  });

  it("calcule la note à partir des seuls avis réels", () => {
    const model = buildProfessionalServicesHomeModel({ site: makeSite(), ...emptyInput, testimonials: [makeQuote(1, 5), makeQuote(2, 3), makeQuote(3, null)] });
    expect(model.testimonials?.isDemo).toBe(false);
    expect(model.hero.rating).toEqual({ average: 4, count: 2 });
  });

  it("reprend les promesses (highlights) telles que fournies, sans les inventer", () => {
    const highlights = [{ icon: "briefcase", title: "Titre A", subtitle: "Sous-titre A" }];
    const model = buildProfessionalServicesHomeModel({ site: makeSite({ highlights }), ...emptyInput });
    expect(model.hero.trust).toEqual(highlights);
  });
});

describe("buildProfessionalServicesHomeModel — couleur d'accent", () => {
  it("calcule un thème lisible à partir de la couleur de marque", () => {
    const model = buildProfessionalServicesHomeModel({ site: makeSite({ accent: { primary: "#F5C518", secondary: "#0EA5E9" } }), ...emptyInput });
    expect(model.theme?.onAccent).toBe("#1b1f1c");
  });
});
