/**
 * Sous-domaines interdits aux entreprises clientes (décision Q29, constat D5) : ils ressembleraient à une page
 * officielle de la plateforme (hameçonnage) ou entreraient en conflit avec ses propres adresses.
 * Doit rester IDENTIQUE à `public.is_reserved_slug` (migration 0193) — un test compare les deux listes.
 */
export const RESERVED_SLUGS: readonly string[] = [
  "www", "admin", "api", "app", "mail", "auth", "login", "pay", "support", "status", "billing", "dashboard",
  "affiliate", "cdn", "static", "flexco", "signup", "register", "invite", "onboarding", "help", "docs", "blog",
  "assets", "smtp", "ftp", "ns1", "ns2",
];

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.includes(slug.trim().toLowerCase());
}
