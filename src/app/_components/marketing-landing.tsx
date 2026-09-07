import Link from "next/link";
import { listPlans, listPlanEntitlements, type PlanKey } from "@/application/services/plans-repository";
import { MarketingMobileMenu } from "./marketing-mobile-menu";
import {
  IconArrowRight,
  IconBotAssist,
  IconBox,
  IconChat,
  IconCheck,
  IconCoins,
  IconGlobeSite,
  IconMegaphone,
  IconPlus,
  IconTrendUp,
  IconUsersGroup,
} from "./marketing-icons";

/**
 * Landing marketing SME-OS (master prompt §6-7) — remplace l'ancienne
 * page de statut de développement interne (`internal-status.tsx`,
 * supprimée par ce lot — plus aucune route ne la rendait, elle n'avait
 * jamais eu vocation à être vue par un client final).
 *
 * Règles de positionnement respectées (§7) : jamais "plateforme IA" (l'IA
 * est mentionnée comme UNE fonctionnalité parmi d'autres, jamais le
 * message central) ; aucun terme technique (API/webhook/provider/RLS/
 * Zernio/Supabase/multi-tenant) dans le texte visible.
 *
 * Les tarifs viennent de la DB (`plans`/`plan_entitlements`, déjà
 * pilotables depuis le Super Admin) — jamais des chiffres codés en dur
 * qui pourraient diverger de ce qui est réellement facturé (§54).
 *
 * Repasse design (réplique pixel par pixel d'une référence fournie par
 * le porteur du projet, sept. 2026) : seul l'habillage visuel change ici
 * (classes `mkt-*`, voir globals.css) — structure des sections, contenu
 * réel et navigation par ancre (#fonctionnalites/#comment-ca-marche/
 * #tarifs/#faq) strictement identiques à avant. La référence montrait
 * une nav "Ressources"/"À propos" et un aperçu de tableau de bord flottant
 * — la nav garde les ancres réelles de cette page plutôt que des liens
 * qui n'existent pas, et l'aperçu ci-dessous est une illustration
 * décorative (aucune donnée réelle) comme sur n'importe quelle landing
 * SaaS, jamais présentée comme un vrai relevé de compte.
 */

const FEATURES = [
  {
    title: "Catalogue central",
    description: "Vos produits et services saisis une seule fois, réutilisés partout : site, WhatsApp, publications.",
    icon: IconBox,
  },
  {
    title: "WhatsApp",
    description: "Recevez et répondez à vos clients, diffusez vos nouveautés dans vos groupes, sans jongler entre plusieurs téléphones.",
    icon: IconChat,
  },
  {
    title: "Publications",
    description: "Programmez la mise en avant de vos produits sur vos réseaux, sans les ressaisir à chaque fois.",
    icon: IconMegaphone,
  },
  {
    title: "Gestion clients",
    description: "Chaque contact, chaque échange, chaque commande au même endroit — plus rien ne se perd dans les conversations.",
    icon: IconUsersGroup,
  },
  {
    title: "Finance",
    description: "Vos revenus et dépenses suivis simplement, pour savoir où vous en êtes sans tenir un cahier à part.",
    icon: IconCoins,
  },
  {
    title: "Votre site",
    description: "Une page professionnelle à votre nom, personnalisable en quelques clics, sans rien coder.",
    icon: IconGlobeSite,
  },
  {
    title: "Assistant intelligent",
    description: "Répond à vos clients avec vos vraies informations (prix, stock, horaires) quand vous n'êtes pas disponible.",
    icon: IconBotAssist,
  },
  {
    title: "Suivi d'activité",
    description: "Visites, demandes, commandes — voyez ce qui marche vraiment dans votre boutique.",
    icon: IconTrendUp,
  },
];

const STEPS = [
  { title: "Créez votre entreprise", description: "Quelques informations : nom, secteur, ville, contact." },
  { title: "Ajoutez vos produits ou services", description: "À la main ou en important votre liste existante." },
  { title: "Connectez vos canaux", description: "WhatsApp et vos réseaux sociaux, en quelques clics." },
  { title: "Publiez", description: "Votre site est en ligne, vos produits sont visibles." },
  { title: "Recevez vos demandes", description: "Conversations, commandes et rendez-vous arrivent au même endroit." },
  { title: "Suivez votre activité", description: "Ventes, clients et résultats, sans tableur ni cahier." },
];

const PROBLEMS = [
  "Vos informations sont éparpillées entre un cahier, votre tête et plusieurs applications.",
  "Vous répondez à vos clients sur WhatsApp un par un, à toute heure.",
  "Publier vos produits sur les réseaux prend du temps et se répète sans fin.",
  "Des clients intéressés se perdent faute de suivi.",
  "Vous ne savez pas vraiment ce qui se vend et ce qui rapporte.",
];

const FAQ_ITEMS = [
  {
    question: "Dois-je savoir coder ou avoir des compétences techniques ?",
    answer: "Non. SME-OS est conçu pour être utilisé par un commerçant, pas par un développeur. Tout se fait depuis votre tableau de bord, en français.",
  },
  {
    question: "Est-ce que ça fonctionne avec le numéro WhatsApp que j'utilise déjà ?",
    answer: "Oui, dans la plupart des cas. Vous connectez votre numéro depuis votre tableau de bord — nous vous guidons à chaque étape.",
  },
  {
    question: "Puis-je essayer avant de payer ?",
    answer: "Oui, chaque nouvelle entreprise démarre avec une période d'essai gratuite, sans engagement.",
  },
  {
    question: "Puis-je changer d'offre ou arrêter à tout moment ?",
    answer: "Oui. Vous changez d'offre depuis votre tableau de bord à tout moment, et vous pouvez arrêter quand vous le souhaitez.",
  },
  {
    question: "Mes informations et celles de mes clients sont-elles en sécurité ?",
    answer: "Oui. Chaque entreprise a ses propres données, strictement séparées de celles des autres entreprises sur SME-OS.",
  },
];

// Placeholders de démonstration — à remplacer par de vrais témoignages
// clients avant mise en production (aucune personne ni entreprise réelle
// représentée ici).
const TESTIMONIALS = [
  {
    name: "Awa",
    business: "Boutique de mode, Yaoundé",
    quote: "Je gère mes commandes WhatsApp et mon catalogue au même endroit. Je ne perds plus le fil de mes clients.",
  },
  {
    name: "Junior",
    business: "Salon de coiffure, Douala",
    quote: "Mes rendez-vous et mes prestations sont enfin organisés. Mes clients réservent plus facilement.",
  },
  {
    name: "Brenda",
    business: "Restaurant, Bafoussam",
    quote: "Mon menu est en ligne et mes clients le consultent directement sur WhatsApp avant de commander.",
  },
];

const PLAN_ENTITLEMENT_LABELS: Record<string, (value: number) => string | null> = {
  whatsapp_groups: (v) => (v === -1 ? "Groupes WhatsApp illimités" : `${v} groupe${v > 1 ? "s" : ""} WhatsApp`),
  broadcast_contacts: (v) => `${v} contacts par diffusion`,
  ai_credits: (v) => `${v} réponses assistant / mois`,
  social_accounts: (v) => (v > 0 ? `${v} compte${v > 1 ? "s" : ""} réseaux sociaux` : null),
};
const PLAN_ENTITLEMENT_ORDER = ["whatsapp_groups", "broadcast_contacts", "ai_credits", "social_accounts"];

async function getPricingPlans() {
  const plans = await listPlans();
  return Promise.all(
    plans.map(async (plan) => {
      const entitlements = await listPlanEntitlements(plan.key as PlanKey);
      const byKey = new Map(entitlements.map((e) => [e.entitlementKey, e.limitValue]));
      const highlights = PLAN_ENTITLEMENT_ORDER.map((key) => {
        const value = byKey.get(key);
        if (value === undefined) return null;
        return PLAN_ENTITLEMENT_LABELS[key]?.(value) ?? null;
      }).filter((h): h is string => Boolean(h));
      return { ...plan, highlights };
    }),
  );
}

/**
 * Aperçu décoratif façon capture d'écran de tableau de bord, comme sur la
 * quasi-totalité des landings SaaS. AUCUNE donnée réelle : chiffres et
 * répartition inventés pour l'illustration, jamais présentés comme un
 * vrai relevé (à la différence du reste de la page, entièrement branché
 * sur de vraies données via `getPricingPlans()`).
 */
function HeroPreview() {
  const bars = [38, 55, 44, 68, 52, 74, 60];
  return (
    <div className="mkt-card mx-auto max-w-3xl !p-3 sm:!p-4">
      <div className="flex items-center gap-1.5 px-2 pb-3 pt-1">
        <span className="h-2.5 w-2.5 rounded-full bg-navy-900/10" />
        <span className="h-2.5 w-2.5 rounded-full bg-navy-900/10" />
        <span className="h-2.5 w-2.5 rounded-full bg-navy-900/10" />
      </div>
      <div className="grid grid-cols-2 gap-3 rounded-xl bg-[#F7F6FD] p-3 sm:grid-cols-4 sm:p-5">
        {[
          { label: "Ventes du mois", value: "—" },
          { label: "Commandes", value: "—" },
          { label: "Nouveaux clients", value: "—" },
          { label: "Panier moyen", value: "—" },
        ].map((chip) => (
          <div key={chip.label} className="rounded-xl bg-white p-3 shadow-[0_1px_2px_rgba(16,23,49,0.05)]">
            <p className="text-[11px] text-slate-400">{chip.label}</p>
            <p className="mt-1 font-jakarta text-base font-bold text-navy-900">{chip.value}</p>
          </div>
        ))}
        <div className="col-span-2 rounded-xl bg-white p-4 shadow-[0_1px_2px_rgba(16,23,49,0.05)] sm:col-span-3">
          <p className="text-[11px] text-slate-400">Évolution</p>
          <div className="mt-3 flex h-24 items-end gap-2">
            {bars.map((h, i) => (
              <div key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-violet-600 to-violet-300" style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-[0_1px_2px_rgba(16,23,49,0.05)]">
          <p className="text-[11px] text-slate-400">Répartition</p>
          <div className="mt-3 flex items-center justify-center">
            <div
              className="relative h-16 w-16 rounded-full"
              style={{ background: "conic-gradient(#5B21E5 0% 40%, #8F6AEA 40% 68%, #B29CF0 68% 88%, #E4DFFB 88% 100%)" }}
            >
              <div className="absolute inset-[5px] rounded-full bg-white" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export async function MarketingLanding() {
  const plans = await getPricingPlans();
  const popularPlanKey = plans.find((p) => p.key === "business")?.key ?? plans[Math.floor(plans.length / 2)]?.key;

  return (
    <div className="mkt-shell">
      {/* HEADER */}
      <header className="sticky top-0 z-40 border-b border-navy-900/[0.06] bg-white/85 backdrop-blur">
        <div className="mkt-container flex items-center justify-between py-4">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 font-jakarta text-sm font-bold text-white">
              S
            </span>
            <span className="font-jakarta text-lg font-bold tracking-tight text-navy-900">SME-OS</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm font-medium text-navy-900/70 md:flex">
            <Link href="#fonctionnalites" className="hover:text-navy-900">Fonctionnalités</Link>
            <Link href="#comment-ca-marche" className="hover:text-navy-900">Comment ça marche</Link>
            <Link href="#tarifs" className="hover:text-navy-900">Tarifs</Link>
            <Link href="#faq" className="hover:text-navy-900">FAQ</Link>
          </nav>
          <div className="hidden items-center gap-5 md:flex">
            <Link href="/login" className="text-sm font-medium text-navy-900/70 hover:text-navy-900">
              Connexion
            </Link>
            <Link href="/login" className="mkt-btn-primary !px-5 !py-2.5">
              Commencer gratuitement
            </Link>
          </div>
          <MarketingMobileMenu />
        </div>
      </header>

      {/* HERO */}
      <section className="mkt-container py-16 md:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <span className="mkt-badge-pill">
            <IconPlus className="h-3.5 w-3.5" />
            La plateforme tout-en-un pour votre entreprise
          </span>
          <h1 className="mt-5 font-jakarta text-3xl font-extrabold tracking-tight text-navy-900 md:text-5xl">
            Gérez toute votre entreprise,
            <br className="hidden sm:block" />
            <span className="text-violet-600"> du catalogue à WhatsApp</span>, en un seul endroit.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-navy-900/60 md:text-lg">
            SME-OS connecte vos produits, vos ventes, vos clients et vos canaux de communication — pour que vous
            passiez moins de temps à jongler entre vos outils, et plus de temps à vendre.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/login" className="mkt-btn-primary w-full sm:w-auto">
              Essayer gratuitement
            </Link>
            <Link href="#comment-ca-marche" className="mkt-btn-secondary w-full sm:w-auto">
              Voir comment ça marche
            </Link>
          </div>
          <div className="mt-6 flex flex-col items-center justify-center gap-2 text-xs font-medium text-navy-900/50 sm:flex-row sm:gap-6">
            <span className="mkt-check"><IconCheck className="h-3.5 w-3.5 text-violet-600" /> Aucune carte bancaire</span>
            <span className="mkt-check"><IconCheck className="h-3.5 w-3.5 text-violet-600" /> Prêt en quelques minutes</span>
            <span className="mkt-check"><IconCheck className="h-3.5 w-3.5 text-violet-600" /> Annulable à tout moment</span>
          </div>
        </div>

        <div className="mt-14">
          <HeroPreview />
        </div>
      </section>

      {/* PROBLÈME */}
      <section className="border-y border-navy-900/[0.06] bg-white py-16">
        <div className="mkt-container max-w-4xl">
          <h2 className="mkt-section-title text-center">Vous reconnaissez votre quotidien ?</h2>
          <ul className="mx-auto mt-8 flex max-w-xl flex-col gap-3">
            {PROBLEMS.map((problem) => (
              <li key={problem} className="flex items-start gap-3 text-sm text-navy-900/70 md:text-base">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-magenta-600" aria-hidden="true" />
                {problem}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* SOLUTION */}
      <section className="mkt-container py-16 text-center">
        <p className="mkt-eyebrow">La solution</p>
        <h2 className="mkt-section-title mt-2">Un seul système qui connecte tout ce qui fait tourner votre entreprise</h2>
        <p className="mx-auto mt-4 max-w-2xl text-navy-900/60">
          Votre catalogue, votre site, WhatsApp, vos réseaux, vos clients et vos finances — reliés entre eux, pas
          juste posés côte à côte.
        </p>
      </section>

      {/* COMMENT ÇA MARCHE */}
      <section id="comment-ca-marche" className="border-y border-navy-900/[0.06] bg-white py-16">
        <div className="mkt-container max-w-5xl">
          <h2 className="mkt-section-title text-center">Comment ça marche</h2>
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <div key={step.title} className="mkt-card">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 font-jakarta text-sm font-bold text-violet-600">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-3 font-jakarta text-base font-semibold text-navy-900">{step.title}</h3>
                <p className="mt-1 text-sm text-navy-900/60">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FONCTIONNALITÉS */}
      <section id="fonctionnalites" className="mkt-container py-16">
        <h2 className="mkt-section-title text-center">Tout ce dont vous avez besoin</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-navy-900/60">
          Une suite complète d&apos;outils simples et puissants.
        </p>
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-4">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="mkt-card">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                <feature.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-3 font-jakarta text-base font-semibold text-navy-900">{feature.title}</h3>
              <p className="mt-1.5 text-sm text-navy-900/60">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* TARIFS */}
      <section id="tarifs" className="border-y border-navy-900/[0.06] bg-white py-16">
        <div className="mkt-container max-w-5xl">
          <h2 className="mkt-section-title text-center">Des offres simples</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-navy-900/60">
            Commencez gratuitement. Changez d&apos;offre à tout moment selon la croissance de votre activité.
          </p>
          {plans.length === 0 ? (
            <p className="mt-10 text-center text-sm text-slate-500">Nos offres seront bientôt disponibles ici.</p>
          ) : (
            <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
              {plans.map((plan) => {
                const isPopular = plan.key === popularPlanKey;
                return (
                  <div
                    key={plan.key}
                    className={`relative flex flex-col rounded-2xl border bg-white p-6 ${
                      isPopular ? "border-violet-600/25 shadow-[0_12px_32px_-12px_rgba(91,33,229,0.28)]" : "border-navy-900/[0.06]"
                    }`}
                  >
                    {isPopular && (
                      <span className="absolute -top-3 right-6 rounded-full bg-gradient-to-r from-magenta-600 to-violet-600 px-3 py-1 text-xs font-semibold text-white">
                        Populaire
                      </span>
                    )}
                    <h3 className="font-jakarta text-lg font-semibold text-navy-900">{plan.name}</h3>
                    <p className="mt-2 font-jakarta text-2xl font-bold text-navy-900">
                      {plan.priceFcfa.toLocaleString("fr-FR")}
                      <span className="text-sm font-normal text-navy-900/50"> FCFA / mois</span>
                    </p>
                    {plan.description && <p className="mt-2 text-sm text-navy-900/60">{plan.description}</p>}
                    {plan.highlights.length > 0 && (
                      <ul className="mt-4 flex flex-col gap-2 text-sm">
                        {plan.highlights.map((h) => (
                          <li key={h} className="flex items-start gap-2 text-navy-900/70">
                            <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
                            {h}
                          </li>
                        ))}
                      </ul>
                    )}
                    <Link href="/login" className={isPopular ? "mkt-btn-primary mt-6" : "mkt-btn-secondary mt-6"}>
                      Commencer
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* TÉMOIGNAGES */}
      <section className="mkt-container py-16">
        <h2 className="mkt-section-title text-center">Ils utilisent SME-OS</h2>
        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <div key={t.name} className="mkt-card">
              <p className="text-sm text-navy-900/70">&laquo; {t.quote} &raquo;</p>
              <div className="mt-4 flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-50 font-jakarta text-xs font-bold text-violet-700">
                  {t.name.charAt(0)}
                </span>
                <div>
                  <p className="text-sm font-medium text-navy-900">{t.name}</p>
                  <p className="text-xs text-slate-500">{t.business}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-y border-navy-900/[0.06] bg-white py-16">
        <div className="mkt-container max-w-3xl">
          <h2 className="mkt-section-title text-center">Questions fréquentes</h2>
          <div className="mt-8 flex flex-col divide-y divide-navy-900/[0.06]">
            {FAQ_ITEMS.map((item) => (
              <details key={item.question} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-navy-900 md:text-base">
                  {item.question}
                  <span className="ml-4 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600 transition-transform group-open:rotate-45">
                    <IconPlus className="h-3.5 w-3.5" />
                  </span>
                </summary>
                <p className="mt-2 text-sm text-navy-900/60">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="mkt-container py-16 text-center">
        <div className="mx-auto max-w-3xl rounded-3xl bg-navy-900 px-6 py-14 sm:px-16">
          <h2 className="font-jakarta text-2xl font-bold tracking-tight text-white md:text-3xl">
            Prêt à organiser votre entreprise ?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-white/60">
            Créez votre compte en quelques minutes. Aucune carte bancaire nécessaire pour commencer.
          </p>
          <Link href="/login" className="mkt-btn-primary mt-7 inline-flex">
            Commencer gratuitement
            <IconArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-navy-900/[0.06] bg-white py-10">
        <div className="mkt-container flex flex-col items-center gap-4 text-sm text-slate-500 md:flex-row md:justify-between">
          <p className="font-jakarta font-semibold text-navy-900">SME-OS</p>
          <nav className="flex flex-wrap items-center justify-center gap-5">
            <Link href="#fonctionnalites" className="hover:text-navy-900">Fonctionnalités</Link>
            <Link href="#tarifs" className="hover:text-navy-900">Tarifs</Link>
            <Link href="/login" className="hover:text-navy-900">Connexion</Link>
            <Link href="/cgu" className="hover:text-navy-900">CGU</Link>
            <Link href="/confidentialite" className="hover:text-navy-900">Confidentialité</Link>
            <Link href="/mentions-legales" className="hover:text-navy-900">Mentions légales</Link>
          </nav>
          <p>&copy; {new Date().getFullYear()} SME-OS. Tous droits réservés.</p>
        </div>
      </footer>
    </div>
  );
}
