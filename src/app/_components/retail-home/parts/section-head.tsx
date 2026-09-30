import Link from "next/link";
import type { ReactNode } from "react";

/**
 * En-tête commun à toutes les sections : un titre, une phrase, et au plus
 * un lien « voir tout ». Un seul gabarit pour toute la page — c'est ce qui
 * donne un rythme constant d'une section à l'autre (l'ancien template
 * redéfinissait ce bloc quatre fois avec quatre jeux de classes).
 */
export function SectionHead({
  id,
  title,
  subtitle,
  action,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string | null;
  action?: { label: string; href: string } | null;
  /** Contenu libre aligné à droite (ex. note moyenne), à la place du lien. */
  children?: ReactNode;
}) {
  return (
    <header className="rt-head">
      <div className="rt-head__text">
        <h2 id={id} className="rt-h2">
          {title}
        </h2>
        {subtitle && <p className="rt-head__sub">{subtitle}</p>}
      </div>
      {children}
      {action && (
        <Link href={action.href} className="rt-link">
          {action.label}
        </Link>
      )}
    </header>
  );
}
