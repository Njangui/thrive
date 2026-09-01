import { MarketingNav } from "../_components/marketing-nav";
import { MarketingFooter } from "../_components/marketing-footer";
import { MIcon } from "../_components/marketing-icons";

export const metadata = {
  title: "Contact — Thrive",
  description: "Contactez l'équipe Thrive pour toute question sur la plateforme.",
};

const CHANNELS = [
  {
    icon: "chat" as const,
    title: "Par email",
    detail: "support@sme-os.app",
    href: "mailto:support@sme-os.app",
  },
];

export default function ContactPage() {
  return (
    <div className="bg-white">
      <MarketingNav />

      <section className="px-5 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Une question ? Écrivez-nous.
          </h1>
          <p className="mt-3 text-sm text-muted">
            Que ce soit sur les plans, la mise en route ou une fonctionnalité précise, l&apos;équipe Thrive vous répond.
          </p>

          <div className="mt-10 flex flex-col items-center gap-4">
            {CHANNELS.map((c) => (
              <a
                key={c.title}
                href={c.href}
                className="flex w-full max-w-sm items-center gap-3 rounded-2xl border border-ink/5 bg-white p-5 text-left shadow-sm hover:shadow-md"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary-dark">
                  <MIcon name={c.icon} className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-ink">{c.title}</span>
                  <span className="block text-sm text-muted">{c.detail}</span>
                </span>
              </a>
            ))}
          </div>

          <p className="mt-8 text-xs text-muted">
            Déjà commerçant sur Thrive ? Utilisez plutôt le support directement depuis votre tableau de bord.
          </p>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}
