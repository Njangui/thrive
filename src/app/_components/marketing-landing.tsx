import Link from "next/link";
import { listPlans, listPlanEntitlements, type PlanKey } from "@/application/services/plans-repository";
import { MarketingMobileMenu } from "./marketing-mobile-menu";

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
 */

const FEATURES = [
  {
    title: "Catalogue central",
    description: "Vos produits et services saisis une seule fois, réutilisés partout : site, WhatsApp, publications.",
  },
  {
    title: "WhatsApp",
    description: "Recevez et répondez à vos clients, diffusez vos nouveautés dans vos groupes, sans jongler entre plusieurs téléphones.",
  },
  {
    title: "Publications",
    description: "Programmez la mise en avant de vos produits sur vos réseaux, sans les ressaisir à chaque fois.",
  },
  {
    title: "Gestion clients",
    description: "Chaque contact, chaque échange, chaque commande au même endroit — plus rien ne se perd dans les conversations.",
  },
  {
    title: "Finance",
    description: "Vos revenus et dépenses suivis simplement, pour savoir où vous en êtes sans tenir un cahier à part.",
  },
  {
    title: "Votre site",
    description: "Une page professionnelle à votre nom, personnalisable en quelques clics, sans rien coder.",
  },
  {
    title: "Assistant intelligent",
    description: "Répond à vos clients avec vos vraies informations (prix, stock, horaires) quand vous n'êtes pas disponible.",
  },
  {
    title: "Suivi d'activité",
    description: "Visites, demandes, commandes — voyez ce qui marche vraiment dans votre boutique.",
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

export async function MarketingLanding() {
  const plans = await getPricingPlans();

  return (
    <div className="bg-paper text-ink">
      {/* HEADER */}
      <header className="sticky top-0 z-40 border-b border-ink/10 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/" className="font-display text-lg font-bold tracking-tight">
            SME-OS
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-ink/80 md:flex">
            <Link href="#fonctionnalites" className="hover:text-ink">Fonctionnalités</Link>
            <Link href="#comment-ca-marche" className="hover:text-ink">Comment ça marche</Link>
            <Link href="#tarifs" className="hover:text-ink">Tarifs</Link>
            <Link href="#faq" className="hover:text-ink">FAQ</Link>
          </nav>
          <div className="hidden items-center gap-3 md:flex">
            <Link href="/login" className="text-sm font-medium text-ink/80 hover:text-ink">
              Connexion
            </Link>
            <Link href="/login" className="rounded-brand bg-leaf px-4 py-2.5 text-sm font-medium text-white hover:opacity-90">
              Commencer gratuitement
            </Link>
          </div>
          <MarketingMobileMenu />
        </div>
      </header>

      {/* HERO */}
      <section className="mx-auto max-w-6xl px-5 py-16 md:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="font-display text-3xl font-bold tracking-tight md:text-5xl">
            Gérez toute votre entreprise, du catalogue à WhatsApp, depuis un seul endroit.
          </h1>
          <p className="mt-5 text-base text-ink/70 md:text-lg">
            SME-OS connecte vos produits, vos ventes, vos clients et vos canaux de communication — pour que vous
            passiez moins de temps à jongler entre vos outils, et plus de temps à vendre.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/login" className="w-full rounded-brand bg-leaf px-6 py-3.5 text-center font-medium text-white hover:opacity-90 sm:w-auto">
              Commencer gratuitement
            </Link>
            <Link href="#comment-ca-marche" className="w-full rounded-brand border border-ink/15 px-6 py-3.5 text-center font-medium text-ink hover:bg-ink/5 sm:w-auto">
              Voir comment ça marche
            </Link>
          </div>
        </div>
      </section>

      {/* PROBLÈME */}
      <section className="border-y border-ink/10 bg-white py-16">
        <div className="mx-auto max-w-4xl px-5">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight md:text-3xl">
            Vous reconnaissez votre quotidien ?
          </h2>
          <ul className="mx-auto mt-8 flex max-w-xl flex-col gap-3">
            {PROBLEMS.map((problem) => (
              <li key={problem} className="flex items-start gap-3 text-sm text-ink/80 md:text-base">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-clay" aria-hidden="true" />
                {problem}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* SOLUTION */}
      <section className="mx-auto max-w-6xl px-5 py-16 text-center">
        <h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
          Un seul système qui connecte tout ce qui fait tourner votre entreprise
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-ink/70">
          Votre catalogue, votre site, WhatsApp, vos réseaux, vos clients et vos finances — reliés entre eux, pas
          juste posés côte à côte.
        </p>
      </section>

      {/* COMMENT ÇA MARCHE */}
      <section id="comment-ca-marche" className="border-y border-ink/10 bg-white py-16">
        <div className="mx-auto max-w-5xl px-5">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight md:text-3xl">Comment ça marche</h2>
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <div key={step.title} className="rounded-brand border border-ink/10 p-5">
                <span className="font-display text-sm font-bold text-leaf">{String(index + 1).padStart(2, "0")}</span>
                <h3 className="mt-2 font-display text-base font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm text-ink/70">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FONCTIONNALITÉS */}
      <section id="fonctionnalites" className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-center font-display text-2xl font-bold tracking-tight md:text-3xl">Tout ce dont vous avez besoin</h2>
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-4">
          {FEATURES.map((feature) => (
            <div key={feature.title} className="rounded-brand border border-ink/10 bg-white p-5">
              <h3 className="font-display text-base font-semibold">{feature.title}</h3>
              <p className="mt-1.5 text-sm text-ink/70">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* TARIFS */}
      <section id="tarifs" className="border-y border-ink/10 bg-white py-16">
        <div className="mx-auto max-w-5xl px-5">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight md:text-3xl">Des offres simples</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-ink/70">
            Commencez gratuitement. Changez d&apos;offre à tout moment selon la croissance de votre activité.
          </p>
          {plans.length === 0 ? (
            <p className="mt-10 text-center text-sm text-muted">Nos offres seront bientôt disponibles ici.</p>
          ) : (
            <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
              {plans.map((plan) => (
                <div key={plan.key} className="flex flex-col rounded-brand border border-ink/10 bg-paper p-6">
                  <h3 className="font-display text-lg font-semibold">{plan.name}</h3>
                  <p className="mt-2 text-2xl font-bold">
                    {plan.priceFcfa.toLocaleString("fr-FR")}
                    <span className="text-sm font-normal text-ink/60"> FCFA / mois</span>
                  </p>
                  {plan.description && <p className="mt-2 text-sm text-ink/70">{plan.description}</p>}
                  {plan.highlights.length > 0 && (
                    <ul className="mt-4 flex flex-col gap-2 text-sm">
                      {plan.highlights.map((h) => (
                        <li key={h} className="flex items-start gap-2 text-ink/80">
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-leaf" aria-hidden="true" />
                          {h}
                        </li>
                      ))}
                    </ul>
                  )}
                  <Link
                    href="/login"
                    className="mt-6 rounded-brand bg-leaf px-4 py-2.5 text-center text-sm font-medium text-white hover:opacity-90"
                  >
                    Commencer
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* TÉMOIGNAGES */}
      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-center font-display text-2xl font-bold tracking-tight md:text-3xl">Ils utilisent SME-OS</h2>
        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <div key={t.name} className="rounded-brand border border-ink/10 bg-white p-6">
              <p className="text-sm text-ink/80">&laquo; {t.quote} &raquo;</p>
              <p className="mt-4 text-sm font-medium">{t.name}</p>
              <p className="text-xs text-muted">{t.business}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="border-y border-ink/10 bg-white py-16">
        <div className="mx-auto max-w-3xl px-5">
          <h2 className="text-center font-display text-2xl font-bold tracking-tight md:text-3xl">Questions fréquentes</h2>
          <div className="mt-8 flex flex-col divide-y divide-ink/10">
            {FAQ_ITEMS.map((item) => (
              <details key={item.question} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-ink md:text-base">
                  {item.question}
                  <span className="ml-4 shrink-0 text-ink/40 transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-2 text-sm text-ink/70">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="mx-auto max-w-4xl px-5 py-16 text-center">
        <h2 className="font-display text-2xl font-bold tracking-tight md:text-3xl">
          Prêt à organiser votre entreprise ?
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-ink/70">
          Créez votre compte en quelques minutes. Aucune carte bancaire nécessaire pour commencer.
        </p>
        <Link
          href="/login"
          className="mt-7 inline-block rounded-brand bg-leaf px-7 py-3.5 font-medium text-white hover:opacity-90"
        >
          Commencer gratuitement
        </Link>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-ink/10 bg-white py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-5 text-sm text-muted md:flex-row md:justify-between">
          <p className="font-display font-semibold text-ink">SME-OS</p>
          <nav className="flex flex-wrap items-center justify-center gap-5">
            <Link href="#fonctionnalites" className="hover:text-ink">Fonctionnalités</Link>
            <Link href="#tarifs" className="hover:text-ink">Tarifs</Link>
            <Link href="/login" className="hover:text-ink">Connexion</Link>
          </nav>
          <p>&copy; {new Date().getFullYear()} SME-OS. Tous droits réservés.</p>
        </div>
      </footer>
    </div>
  );
}
