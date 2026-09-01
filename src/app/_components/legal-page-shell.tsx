import { MarketingNav } from "./marketing-nav";
import { MarketingFooter } from "./marketing-footer";

export function LegalPageShell({
  title,
  updatedAt,
  children,
}: {
  title: string;
  updatedAt?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white">
      <MarketingNav />
      <article className="mx-auto max-w-2xl px-5 py-16">
        <h1 className="font-display text-3xl font-bold tracking-tight text-ink">{title}</h1>
        {updatedAt && <p className="mt-2 text-sm text-muted">Dernière mise à jour : {updatedAt}</p>}
        <div className="prose-legal mt-8 flex flex-col gap-6 text-sm leading-relaxed text-ink/80">{children}</div>
      </article>
      <MarketingFooter />
    </div>
  );
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
      <div className="mt-2 flex flex-col gap-2">{children}</div>
    </section>
  );
}
