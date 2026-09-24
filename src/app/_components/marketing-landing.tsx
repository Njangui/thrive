import Link from "next/link";
import Image from "next/image";
import { listPublicCountries, isoCodeToFlagEmoji } from "@/application/services/country-service";
import { joinWaitlistAction } from "./country-waitlist-actions";
import { tokoo Brand } from "./tokoo -brand";
import { MarketingMobileMenu } from "./marketing-mobile-menu";
import { LazyAfricaAvailabilityMap } from "./africa-availability-map-lazy";
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
 * Landing marketing tokoo  (master prompt §6-7) — remplace l'ancienne
 * page de statut de développement interne (`internal-status.tsx`,
 * supprimée par ce lot — plus aucune route ne la rendait, elle n'avait
 * jamais eu vocation à être vue par un client final).
 *
 * Règles de positionnement respectées (§7) : jamais "plateforme IA" (l'IA
 * est mentionnée comme UNE fonctionnalité parmi d'autres, jamais le
 * message central) ; aucun terme technique (API/webhook/provider/RLS/
 * Zernio/Supabase/multi-tenant) dans le texte visible.
 *
 * Repasse design (réplique pixel par pixel d'une référence fournie par
 * le porteur du projet, sept. 2026) : seul l'habillage visuel change ici
 * (classes `mkt-*`, voir globals.css) — structure des sections, contenu
 * réel et navigation par ancre (#fonctionnalites/#comment-ca-marche/#faq)
 * strictement identiques à avant. La référence montrait une nav
 * "Ressources"/"À propos" et un aperçu de tableau de bord flottant — la
 * nav garde les ancres réelles de cette page plutôt que des liens qui
 * n'existent pas, et l'aperçu ci-dessous est une illustration décorative
 * (donnée de démonstration, aucune vraie entreprise) comme sur n'importe
 * quelle landing SaaS, jamais présentée comme un vrai relevé de compte.
 *
 * Section tarifs retirée d'ici (sept. 2026) : les offres réelles vivent
 * désormais sur leur propre page (`/tarifs`, DB-driven, indépendante de
 * ce fichier) et le lien "Tarifs" du header/footer/menu mobile y pointe
 * déjà directement — garder une section tarifs dupliquée ici aurait
 * signifié deux sources pour le même prix, avec le risque qu'elles
 * divergent avec le temps.
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
    answer: "Non. tokoo  est conçu pour être utilisé par un commerçant, pas par un développeur. Tout se fait depuis votre tableau de bord, en français.",
  },
  {
    question: "Est-ce que ça fonctionne avec le numéro WhatsApp que j'utilise déjà ?",
    answer: "Oui, dans la plupart des cas. Vous connectez votre numéro depuis votre tableau de bord — nous vous guidons à chaque étape.",
  },
  {
    question: "Puis-je essayer avant de payer ?",
    answer: "Oui. Chaque nouvelle entreprise démarre sur l'offre gratuite Discover — sans limite de durée et sans carte bancaire — et passe à une offre payante seulement quand elle en a besoin.",
  },
  {
    question: "Puis-je changer d'offre ou arrêter à tout moment ?",
    answer: "Oui. Vous changez d'offre depuis votre tableau de bord à tout moment, et vous pouvez arrêter quand vous le souhaitez.",
  },
  {
    question: "Mes informations et celles de mes clients sont-elles en sécurité ?",
    answer: "Oui. Chaque entreprise a ses propres données, strictement séparées de celles des autres entreprises sur tokoo .",
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

/**
 * Aperçu décoratif façon capture d'écran de tableau de bord, comme sur la
 * quasi-totalité des landings SaaS. Donnée de démonstration ("StyleHub
 * Boutique"), aucune vraie entreprise ni vrai relevé de compte — à la
 * différence du reste de la page, qui reste branché sur de vraies
 * données (pays, offres sur `/tarifs`, etc).
 */
function HeroPreview() {
  return (
    <div className="relative mx-auto max-w-3xl">
      <div className="mkt-dashboard-frame relative overflow-hidden rounded-[1.35rem] border border-white/80 bg-white shadow-[0_30px_80px_-30px_rgba(14,17,48,0.38)]">
        <div className="absolute inset-x-0 top-0 z-10 h-10 bg-gradient-to-b from-white/90 to-transparent" />
        <Image
          src="/images/landing-dashboard-reference.png"
          alt="Aperçu du tableau de bord tokoo "
          width={826}
          height={1024}
          priority
          className="w-full"
        />
      </div>
      <Image
        src="/images/landing-mobile-reference.png"
        alt="Aperçu mobile tokoo "
        width={135}
        height={260}
        className="absolute -bottom-7 -left-4 hidden w-[100px] rounded-xl border border-navy-900/10 shadow-[0_18px_35px_-16px_rgba(14,17,48,0.5)] sm:block md:-left-10 md:w-[115px]"
      />
    </div>
  );
}

export async function MarketingLanding({
  waitlistFeedback,
  isAuthenticated,
}: {
  waitlistFeedback?: { success?: string; error?: string };
  isAuthenticated?: boolean;
} = {}) {
  // Country Engine (section 22) : jamais une liste écrite en dur — pilotée
  // par le Super Admin (/admin/countries), synchronisée depuis NotchPay.
  const countries = await listPublicCountries();
  const activeCountries = countries.filter((c) => c.launchStatus === "active");
  const upcomingCountries = countries.filter((c) => c.launchStatus === "coming_soon" || c.launchStatus === "waitlist");

  return (
    <div className="mkt-shell">
      {/* HEADER */}
      <header className="sticky top-0 z-40 border-b border-navy-900/[0.06] bg-white/85 backdrop-blur-sm">
        <div className="mkt-container flex items-center justify-between py-4">
<tokoo Brand href="/" />
          <nav className="hidden items-center gap-7 text-sm font-medium text-navy-900/70 md:flex">
            <Link href="#fonctionnalites" className="hover:text-navy-900">Fonctionnalités</Link>
            <Link href="#comment-ca-marche" className="hover:text-navy-900">Comment ça marche</Link>
            <Link href="/tarifs" className="hover:text-navy-900">Tarifs</Link>
            <Link href="#faq" className="hover:text-navy-900">FAQ</Link>
            <Link href="/devenir-affilie" className="hover:text-navy-900">Devenir affilié</Link>
          </nav>
          <div className="hidden items-center gap-5 md:flex">
            {isAuthenticated ? (
              <Link href="/dashboard" className="mkt-btn-primary !px-5 !py-2.5">
                Accéder à mon tableau de bord
              </Link>
            ) : (
              <>
                <Link href="/login" className="text-sm font-medium text-navy-900/70 hover:text-navy-900">
                  Connexion
                </Link>
                <Link href="/signup" className="mkt-btn-primary !px-5 !py-2.5">
                  Commencer gratuitement
                </Link>
              </>
            )}
          </div>
          <MarketingMobileMenu isAuthenticated={isAuthenticated} />
        </div>
      </header>

      {/* HERO */}
      <section className="mkt-container py-16 md:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <span className="mkt-badge-pill">
            <IconTrendUp className="h-3.5 w-3.5" />
            Plus qu’un outil, un levier de croissance
          </span>
          <h1 className="mt-5 font-jakarta text-3xl font-extrabold tracking-tight text-navy-900 md:text-5xl">
            Gérez. Vendez. Communiquez.
            <br className="hidden sm:block" />
            <span className="text-violet-600"> Faites grandir votre entreprise.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-navy-900/60 md:text-lg">
            tokoo  réunit votre activité dans un seul espace : catalogue, ventes, clients, communication et finances.
            Vous gagnez en clarté, en temps et en capacité de croissance.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {isAuthenticated ? (
              <Link href="/dashboard" className="mkt-btn-primary w-full sm:w-auto">
                Accéder à mon tableau de bord
              </Link>
            ) : (
              <Link href="/signup" className="mkt-btn-primary w-full sm:w-auto">
                Essayer gratuitement
              </Link>
            )}
            <Link href="#comment-ca-marche" className="mkt-btn-secondary w-full sm:w-auto">
              Voir comment ça marche
            </Link>
          </div>
          {!isAuthenticated && (
            <div className="mt-6 flex flex-col items-center justify-center gap-2 text-xs font-medium text-navy-900/50 sm:flex-row sm:gap-6">
              <span className="mkt-check"><IconCheck className="h-3.5 w-3.5 text-violet-600" /> Aucune carte bancaire</span>
              <span className="mkt-check"><IconCheck className="h-3.5 w-3.5 text-violet-600" /> Prêt en quelques minutes</span>
              <span className="mkt-check"><IconCheck className="h-3.5 w-3.5 text-violet-600" /> Annulable à tout moment</span>
            </div>
          )}
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

      {/* DISPONIBILITÉ PAYS */}
      {(activeCountries.length > 0 || upcomingCountries.length > 0) && (
        <section id="disponibilite" className="mkt-container max-w-5xl py-16 text-center">
          <h2 className="mkt-section-title">Disponible en Afrique</h2>
          <p className="mx-auto mt-3 max-w-xl text-navy-900/60">
            tokoo  s&apos;étend progressivement à de nouveaux pays.
          </p>

          {waitlistFeedback?.error && (
            <p className="mx-auto mt-6 max-w-md rounded-xl border border-danger-600/20 bg-danger-50 px-4 py-3 text-sm text-danger-700">
              {waitlistFeedback.error}
            </p>
          )}
          {waitlistFeedback?.success && (
            <p className="mx-auto mt-6 max-w-md rounded-xl border border-success-600/20 bg-success-50 px-4 py-3 text-sm text-success-700">
              {waitlistFeedback.success}
            </p>
          )}

          {activeCountries.length > 0 && (
            <div className="mt-10">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Disponible actuellement</h3>

              <div className="mt-6">
                <LazyAfricaAvailabilityMap countries={countries} />
              </div>

              <div className="mt-8 grid grid-cols-1 gap-4 text-left sm:grid-cols-2 md:grid-cols-3">
                {activeCountries.map((c) => (
                  <div key={c.isoCode} className="mkt-card flex items-center gap-3">
                    {c.flagUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- icône de drapeau externe, taille fixe, next/image inutile ici
                      <img
                        src={c.flagUrl}
                        alt=""
                        className="h-8 w-11 shrink-0 rounded-sm object-cover"
                      />
                    ) : (
                      <span className="text-3xl leading-none" aria-hidden="true">
                        {isoCodeToFlagEmoji(c.isoCode)}
                      </span>
                    )}
                    <div>
                      <p className="font-jakarta font-semibold text-navy-900">{c.name}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {c.currencyCode}
                        {c.currencySymbol ? ` (${c.currencySymbol})` : ""} · {c.phoneCode}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {upcomingCountries.length > 0 && (
            <div className="mt-10">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Bientôt disponible</h3>
              <div className="mt-4 grid grid-cols-1 gap-4 text-left sm:grid-cols-2 md:grid-cols-3">
                {upcomingCountries.map((c) => (
                  <div key={c.isoCode} className="mkt-card">
                    <p className="font-jakarta font-semibold text-navy-900">
                      {isoCodeToFlagEmoji(c.isoCode)} {c.name}
                    </p>
                    <form action={joinWaitlistAction} className="mt-3 flex flex-col gap-2">
                      <input type="hidden" name="countryCode" value={c.isoCode} />
                      <input
                        name="email"
                        type="email"
                        required
                        placeholder="Votre email"
                        className="rounded-xl border border-navy-900/[0.09] px-3 py-2 text-sm text-navy-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-hidden focus:ring-2 focus:ring-violet-100"
                      />
                      <input
                        name="companyName"
                        placeholder="Nom de l'entreprise (optionnel)"
                        className="rounded-xl border border-navy-900/[0.09] px-3 py-2 text-sm text-navy-900 placeholder:text-slate-400 focus:border-violet-400 focus:outline-hidden focus:ring-2 focus:ring-violet-100"
                      />
                      <button type="submit" className="mkt-btn-primary !py-2 !text-xs">
                        Être prévenu
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* TÉMOIGNAGES */}
      <section className="mkt-container py-16">
        <h2 className="mkt-section-title text-center">Ils utilisent tokoo </h2>
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
          {isAuthenticated ? (
            <>
              <h2 className="font-jakarta text-2xl font-bold tracking-tight text-white md:text-3xl">
                Prêt à continuer votre activité ?
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-white/60">
                Retrouvez votre catalogue, vos clients et vos ventes là où vous les avez laissés.
              </p>
              <Link href="/dashboard" className="mkt-btn-primary mt-7 inline-flex">
                Accéder à mon tableau de bord
                <IconArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </>
          ) : (
            <>
              <h2 className="font-jakarta text-2xl font-bold tracking-tight text-white md:text-3xl">
                Prêt à organiser votre entreprise ?
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-white/60">
                Créez votre compte en quelques minutes. Aucune carte bancaire nécessaire pour commencer.
              </p>
              <Link href="/signup" className="mkt-btn-primary mt-7 inline-flex">
                Commencer gratuitement
                <IconArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </>
          )}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-navy-900/[0.06] bg-white py-10">
        <div className="mkt-container flex flex-col items-center gap-4 text-sm text-slate-500 md:flex-row md:justify-between">
          <p className="font-jakarta font-semibold text-navy-900">tokoo </p>
          <nav className="flex flex-wrap items-center justify-center gap-5">
            <Link href="#fonctionnalites" className="hover:text-navy-900">Fonctionnalités</Link>
            <Link href="/tarifs" className="hover:text-navy-900">Tarifs</Link>
            <Link href="/devenir-affilie" className="hover:text-navy-900">Devenir affilié</Link>
            {isAuthenticated ? (
              <Link href="/dashboard" className="hover:text-navy-900">Tableau de bord</Link>
            ) : (
              <Link href="/login" className="hover:text-navy-900">Connexion</Link>
            )}
            <Link href="/cgu" className="hover:text-navy-900">CGU</Link>
            <Link href="/confidentialite" className="hover:text-navy-900">Confidentialité</Link>
            <Link href="/mentions-legales" className="hover:text-navy-900">Mentions légales</Link>
          </nav>
          <p>&copy; {new Date().getFullYear()} tokoo . Tous droits réservés.</p>
        </div>
      </footer>
    </div>
  );
}