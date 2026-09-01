import Link from "next/link";
import { MarketingNav } from "./marketing-nav";
import { MarketingFooter } from "./marketing-footer";
import { MarketingFaq } from "./marketing-faq";
import { MIcon } from "./marketing-icons";

const FEATURES = [
  {
    icon: "box" as const,
    color: "bg-primary-light text-primary-dark",
    title: "Catalogue & Stock",
    description: "Gérez vos produits, vos stocks et vos catégories facilement, depuis un seul endroit.",
  },
  {
    icon: "users" as const,
    color: "bg-success-light text-success",
    title: "Commandes & Clients",
    description: "Suivez vos commandes et gardez une fiche à jour de chacun de vos clients.",
  },
  {
    icon: "megaphone" as const,
    color: "bg-accent-pink/10 text-accent-pink",
    title: "Marketing multicanal",
    description: "Diffusez vos produits sur WhatsApp, Facebook, Instagram et plus, en quelques clics.",
  },
  {
    icon: "sparkle" as const,
    color: "bg-warning-light text-warning",
    title: "IA & automatisation",
    description: "Répondez automatiquement à vos clients sur WhatsApp et qualifiez vos leads pendant que vous travaillez.",
  },
];

const TRUST_POINTS = [
  { icon: "chat" as const, label: "WhatsApp + réseaux sociaux" },
  { icon: "sparkle" as const, label: "Assistant IA dès le plan gratuit" },
  { icon: "globe" as const, label: "Pensé pour le Cameroun (FCFA)" },
  { icon: "shield" as const, label: "Sans engagement" },
];

const STEPS = [
  {
    title: "Créez votre compte",
    description: "Inscription gratuite, sans carte bancaire. Votre boutique est prête en quelques minutes.",
  },
  {
    title: "Ajoutez votre catalogue et connectez WhatsApp",
    description: "Importez vos produits ou services, puis connectez votre numéro WhatsApp Business.",
  },
  {
    title: "Vendez et laissez l'IA vous assister",
    description:
      "Vos clients commandent et posent leurs questions sur WhatsApp — l'assistant répond aux questions courantes et vous alerte pour le reste.",
  },
];

const CHANNELS = [
  { label: "WhatsApp", color: "bg-success/15 text-success" },
  { label: "Facebook", color: "bg-primary/15 text-primary-dark" },
  { label: "Instagram", color: "bg-accent-pink/15 text-accent-pink" },
  { label: "TikTok", color: "bg-ink/10 text-ink" },
  { label: "YouTube", color: "bg-danger/15 text-danger" },
  { label: "LinkedIn", color: "bg-primary/15 text-primary-dark" },
  { label: "Threads", color: "bg-ink/10 text-ink" },
  { label: "X", color: "bg-ink/10 text-ink" },
  { label: "Reddit", color: "bg-danger/15 text-danger" },
  { label: "Bluesky", color: "bg-primary/15 text-primary-dark" },
];

/**
 * Avis illustratifs — placeholders à remplacer par de vrais retours clients
 * une fois disponibles (pas de faux avis présentés comme vérifiés).
 */
const TESTIMONIALS = [
  {
    name: "Aïcha",
    business: "Boutique de mode, Yaoundé",
    quote: "Mes clientes commandent directement sur WhatsApp et je ne perds plus le fil de mes stocks.",
  },
  {
    name: "Bertrand",
    business: "Traiteur événementiel, Douala",
    quote: "L'assistant IA répond aux questions courantes la nuit — je récupère les demandes sérieuses le matin.",
  },
  {
    name: "Solange",
    business: "Institut de beauté, Bafoussam",
    quote: "La prise de rendez-vous et le suivi des paiements sont enfin regroupés au même endroit.",
  },
];

const CHECKS = ["Aucune carte bancaire", "Configuration en 2 minutes", "Annulable à tout moment"];

export function PlatformLanding() {
  return (
    <div className="bg-white">
      <MarketingNav />

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-primary-light/40 to-white px-5 py-20 text-center">
        <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative mx-auto max-w-3xl">
          <span className="mx-auto flex w-fit items-center gap-1.5 rounded-full border border-primary/20 bg-white px-3 py-1 text-xs font-medium text-primary-dark shadow-sm">
            <MIcon name="diamond" className="h-3.5 w-3.5" />
            La plateforme tout-en-un pour votre commerce
          </span>

          <h1 className="mt-5 font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">
            Gérez, développez et automatisez
            <br />
            <span className="bg-gradient-to-r from-primary to-accent-pink bg-clip-text text-transparent">
              votre commerce en toute simplicité
            </span>
          </h1>

          <p className="mx-auto mt-5 max-w-xl text-base text-muted">
            Thrive regroupe tous les outils dont vous avez besoin pour gérer vos ventes, vos clients, votre
            communication et votre marketing sur une seule plateforme.
          </p>

          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/onboarding"
              className="rounded-full bg-primary px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-primary-dark"
            >
              Essayer gratuitement
            </Link>
            <a
              href="#fonctionnalites"
              className="rounded-full border border-ink/15 bg-white px-6 py-3 text-sm font-medium text-ink hover:bg-surface"
            >
              Voir les fonctionnalités
            </a>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted">
            {CHECKS.map((c) => (
              <span key={c} className="flex items-center gap-1.5">
                <MIcon name="check" className="h-4 w-4 text-success" />
                {c}
              </span>
            ))}
          </div>
        </div>

        {/* Aperçu produit — représentation simplifiée du dashboard, pas une vraie capture d'écran */}
        <div className="relative mx-auto mt-14 max-w-4xl">
          <div className="overflow-hidden rounded-2xl border border-ink/10 bg-white shadow-xl">
            <div className="flex items-center gap-1.5 border-b border-ink/5 bg-surface px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-danger/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
            </div>
            <div className="grid grid-cols-4 gap-3 p-5 text-left">
              <div className="col-span-1 space-y-2 rounded-xl bg-sidebar-dark p-3">
                <div className="h-2 w-16 rounded bg-white/30" />
                <div className="mt-3 h-6 rounded bg-primary/70" />
                <div className="h-2 w-full rounded bg-white/10" />
                <div className="h-2 w-3/4 rounded bg-white/10" />
                <div className="h-2 w-5/6 rounded bg-white/10" />
              </div>
              <div className="col-span-3 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="rounded-lg border border-ink/5 bg-white p-3 shadow-sm">
                      <div className="h-2 w-12 rounded bg-ink/10" />
                      <div className="mt-2 h-3 w-16 rounded bg-primary/60" />
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-ink/5 bg-white p-3 shadow-sm">
                  <svg viewBox="0 0 300 70" className="h-16 w-full" preserveAspectRatio="none">
                    <path
                      d="M0 55 Q 30 20 60 40 T 120 30 T 180 45 T 240 15 T 300 30"
                      fill="none"
                      stroke="#7C3AED"
                      strokeWidth="3"
                    />
                  </svg>
                </div>
              </div>
            </div>
          </div>

          {/* Mockup mobile flottant */}
          <div className="absolute -bottom-10 -left-6 hidden w-32 rounded-2xl border border-ink/10 bg-sidebar-dark p-2 shadow-xl sm:block">
            <div className="h-2 w-14 rounded bg-white/40" />
            <div className="mt-2 aspect-[4/3] rounded-lg bg-gradient-to-br from-primary to-accent-pink" />
            <div className="mt-2 grid grid-cols-3 gap-1">
              <div className="h-6 rounded bg-white/10" />
              <div className="h-6 rounded bg-white/10" />
              <div className="h-6 rounded bg-white/10" />
            </div>
          </div>
        </div>

        {/* Bandeau de confiance — capacités réelles du produit, pas des statistiques inventées */}
        <div className="relative mx-auto mt-16 flex max-w-4xl flex-wrap items-center justify-center gap-x-10 gap-y-4 border-t border-ink/5 pt-8 text-sm text-muted">
          {TRUST_POINTS.map((p) => (
            <span key={p.label} className="flex items-center gap-2">
              <MIcon name={p.icon} className="h-4 w-4 text-primary" />
              {p.label}
            </span>
          ))}
        </div>
      </section>

      {/* Fonctionnalités */}
      <section id="fonctionnalites" className="px-5 py-20">
        <div className="mx-auto max-w-5xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight text-ink">
            Tout ce dont vous avez besoin pour faire grandir votre commerce
          </h2>
          <p className="mt-2 text-sm text-muted">Une suite complète d&apos;outils simples et puissants.</p>

          <div className="mt-12 grid grid-cols-1 gap-5 text-left sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-2xl border border-ink/5 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
              >
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${f.color}`}>
                  <MIcon name={f.icon} className="h-5 w-5" />
                </span>
                <p className="mt-4 font-display text-base font-semibold text-ink">{f.title}</p>
                <p className="mt-1.5 text-sm text-muted">{f.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comment ça marche */}
      <section id="comment-ca-marche" className="bg-surface px-5 py-20">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight text-ink">Comment ça marche</h2>
          <p className="mt-2 text-sm text-muted">Trois étapes pour commencer à vendre.</p>

          <div className="mt-12 grid grid-cols-1 gap-8 text-left sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <div key={step.title} className="relative rounded-2xl border border-ink/5 bg-white p-6 shadow-sm">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary font-display text-sm font-bold text-white">
                  {i + 1}
                </span>
                <p className="mt-4 font-display text-base font-semibold text-ink">{step.title}</p>
                <p className="mt-1.5 text-sm text-muted">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Canaux connectés */}
      <section id="canaux" className="px-5 py-20">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight text-ink">Vendez là où sont vos clients</h2>
          <p className="mt-2 text-sm text-muted">
            WhatsApp comme canal principal, et vos réseaux sociaux pour vous faire découvrir.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            {CHANNELS.map((c) => (
              <span
                key={c.label}
                className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium ${c.color}`}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/70 text-[10px] font-bold">
                  {c.label.slice(0, 1)}
                </span>
                {c.label}
              </span>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted">
            La disponibilité de chaque canal dépend de votre plan —{" "}
            <Link href="/tarifs" className="font-medium text-primary hover:underline">
              voir le détail des plans
            </Link>
            .
          </p>
        </div>
      </section>

      {/* Avis */}
      <section id="avis" className="bg-surface px-5 py-20">
        <div className="mx-auto max-w-5xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight text-ink">Ils utilisent Thrive au quotidien</h2>
          <p className="mt-2 text-sm text-muted">Des commerçants et prestataires qui gèrent leur activité avec Thrive.</p>

          <div className="mt-12 grid grid-cols-1 gap-5 text-left sm:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="rounded-2xl border border-ink/5 bg-white p-5 shadow-sm">
                <div className="flex gap-0.5 text-warning">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <MIcon key={i} name="star" className="h-4 w-4" />
                  ))}
                </div>
                <p className="mt-3 text-sm text-ink/80">&laquo; {t.quote} &raquo;</p>
                <p className="mt-4 text-sm font-semibold text-ink">{t.name}</p>
                <p className="text-xs text-muted">{t.business}</p>
              </div>
            ))}
          </div>

          <Link
            href="/tarifs"
            className="mt-10 inline-flex items-center gap-1.5 rounded-full bg-primary px-6 py-3 text-sm font-medium text-white hover:bg-primary-dark"
          >
            Voir les tarifs
            <MIcon name="arrowRight" className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="px-5 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="font-display text-3xl font-bold tracking-tight text-ink">Questions fréquentes</h2>
          <p className="mt-2 text-sm text-muted">Tout ce qu&apos;il faut savoir avant de commencer.</p>
          <MarketingFaq />
        </div>
      </section>

      {/* CTA final */}
      <section className="px-5 py-16">
        <div className="mx-auto max-w-4xl rounded-3xl bg-gradient-to-r from-primary to-accent-pink px-8 py-14 text-center shadow-lg">
          <h2 className="font-display text-3xl font-bold tracking-tight text-white">
            Prêt à faire grandir votre commerce ?
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-white/85">
            Créez votre compte gratuitement et connectez votre WhatsApp en quelques minutes.
          </p>
          <Link
            href="/onboarding"
            className="mt-7 inline-flex items-center gap-1.5 rounded-full bg-white px-6 py-3 text-sm font-medium text-primary-dark shadow-sm hover:bg-white/90"
          >
            Démarrer gratuitement
            <MIcon name="arrowRight" className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
