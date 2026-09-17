import Link from "next/link";
import type { ReactNode } from "react";
import { IconArrowRight } from "./storefront-icons";

/**
 * Primitives de mise en page partagées par toutes les pages de la
 * vitrine. Elles existent pour une raison précise : avant ce chantier,
 * chaque section réinventait son en-tête (`<h2 className="font-display
 * text-lg font-semibold">`), si bien qu'un titre de section de la page
 * d'accueil et un titre de page du catalogue n'avaient ni la même taille,
 * ni la même graisse, ni le même espacement. Une vitrine « mûre » se
 * reconnaît d'abord à ça : un rythme constant d'une page à l'autre.
 */

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>;
}

export function Section({
  children,
  className = "",
  tone = "default",
  id,
}: {
  children: ReactNode;
  className?: string;
  /** `muted` = fond légèrement teinté de la couleur de marque, pour alterner le rythme vertical. */
  tone?: "default" | "muted" | "brand";
  id?: string;
}) {
  const toneClass =
    tone === "muted" ? "sf-section-muted" : tone === "brand" ? "sf-section-brand" : "";
  return (
    <section id={id} className={`py-10 sm:py-14 ${toneClass} ${className}`}>
      <Container>{children}</Container>
    </section>
  );
}

export function SectionHeading({
  title,
  subtitle,
  action,
  align = "left",
}: {
  title: string;
  subtitle?: string | null;
  action?: { label: string; href: string };
  align?: "left" | "center";
}) {
  return (
    <div
      className={`mb-6 flex flex-col gap-2 sm:mb-8 ${
        align === "center" ? "items-center text-center" : "sm:flex-row sm:items-end sm:justify-between"
      }`}
    >
      <div className={align === "center" ? "max-w-2xl" : ""}>
        <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
        {subtitle && <p className="mt-1.5 text-sm text-black/60 sm:text-base">{subtitle}</p>}
      </div>
      {action && (
        <Link
          href={action.href}
          className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
        >
          {action.label}
          <IconArrowRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

/**
 * État vide EXPLICATIF, jamais décoratif : il dit ce qui manque et
 * propose une sortie réelle (un lien qui existe). Une grille vide sans
 * message laisse le visiteur croire que le site est cassé.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="rounded-brand border border-dashed border-black/15 px-6 py-12 text-center">
      <p className="font-display text-base font-semibold">{title}</p>
      {description && <p className="mx-auto mt-2 max-w-md text-sm text-black/60">{description}</p>}
      {action && (
        <Link href={action.href} className="mt-4 inline-flex text-sm font-semibold text-brand hover:underline">
          {action.label}
        </Link>
      )}
    </div>
  );
}

/**
 * Fil d'Ariane. Rendu aussi en JSON-LD `BreadcrumbList` par les pages qui
 * l'utilisent — c'est ce qui permet à Google d'afficher le chemin sous le
 * résultat plutôt que l'URL brute.
 */
export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Fil d'Ariane" className="mb-4 text-xs text-black/50">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
            {item.href && index < items.length - 1 ? (
              <Link href={item.href} className="hover:text-brand hover:underline">
                {item.label}
              </Link>
            ) : (
              <span aria-current={index === items.length - 1 ? "page" : undefined} className="text-black/70">
                {item.label}
              </span>
            )}
            {index < items.length - 1 && <span aria-hidden>/</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="border-b border-black/[0.07] py-8 sm:py-10">
      <Container>
        {children}
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">{eyebrow}</p>
        )}
        <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
        {description && <p className="mt-3 max-w-2xl text-sm leading-7 text-black/60 sm:text-base">{description}</p>}
      </Container>
    </div>
  );
}

/**
 * Pagination par liens `<a>` (pas de JS) : les pages de catalogue doivent
 * rester crawlables et fonctionner sur un navigateur dégradé, cas
 * fréquent sur mobile en connexion faible.
 */
export function Pagination({
  page,
  totalPages,
  buildHref,
}: {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav aria-label="Pagination" className="mt-8 flex items-center justify-between gap-4 text-sm">
      {page > 1 ? (
        <Link href={buildHref(page - 1)} rel="prev" className="sf-btn-outline">
          Précédent
        </Link>
      ) : (
        <span />
      )}
      <p className="text-black/60">
        Page {page} sur {totalPages}
      </p>
      {page < totalPages ? (
        <Link href={buildHref(page + 1)} rel="next" className="sf-btn-outline">
          Suivant
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
