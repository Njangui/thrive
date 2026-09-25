/**
 * Quel « site » répond à cette requête ? — logique PURE, testée en
 * isolation (request-surface.test.ts). La lecture des headers et de la DB
 * vit dans `infrastructure/tenant/resolve-request-tenant.ts`
 * (`resolveRequestSurface`) ; ce fichier ne contient que la règle.
 *
 * Pourquoi cette notion existe : une même application sert TROIS choses
 * sous des hôtes différents, et le SEO de chacune est opposé.
 *
 *  - `marketing`    : le domaine racine de la plateforme (NEXT_PUBLIC_ROOT_DOMAIN,
 *                     ou son `www.`) — la landing Flexco, /tarifs, etc.
 *                     À indexer, avec la plateforme comme canonique.
 *  - `tenant`       : la vitrine d'un commerçant (sous-domaine ou domaine
 *                     custom vérifié). À indexer, avec le tenant comme canonique.
 *  - `unrecognized` : tout le reste — sous-domaine inconnu, tenant
 *                     suspendu/annulé, déploiement de prévisualisation
 *                     Vercel. Rien à indexer.
 *
 * Avant cette distinction, `robots.ts` traitait « pas de tenant » comme
 * « domaine interne à ne jamais indexer » : la landing marketing, /tarifs
 * et /devenir-affilie étaient donc bloquées pour Google alors que leurs
 * métadonnées avaient été écrites pour être indexées.
 */

export type RequestSurface = "marketing" | "tenant" | "unrecognized";

export function isPlatformRootHost(host: string, rootDomain: string): boolean {
  const normalizedHost = host.trim().toLowerCase();
  const normalizedRoot = rootDomain.trim().toLowerCase();
  if (!normalizedHost || !normalizedRoot) return false;
  return normalizedHost === normalizedRoot || normalizedHost === `www.${normalizedRoot}`;
}

export function classifySurface(input: { hasTenant: boolean; host: string; rootDomain: string }): RequestSurface {
  if (input.hasTenant) return "tenant";
  return isPlatformRootHost(input.host, input.rootDomain) ? "marketing" : "unrecognized";
}

/**
 * Origine CANONIQUE de la plateforme, construite depuis le domaine racine
 * (et non depuis le `host` de la requête, qui peut être `www.`) ni depuis
 * `NEXT_PUBLIC_APP_URL` (défaut `http://localhost:3000` : une variable
 * oubliée en production ferait pointer toutes les canoniques vers
 * localhost). Même règle de protocole que `resolveRequestOrigin`.
 */
export function buildPlatformOrigin(rootDomain: string): string {
  const root = rootDomain.trim().toLowerCase();
  const protocol = root.startsWith("localhost") || root.startsWith("127.0.0.1") ? "http" : "https";
  return `${protocol}://${root}`;
}

/**
 * Surfaces authentifiées, techniques ou à effet de bord : jamais explorées.
 * `/r/` (redirection d'affiliation) y figure aussi pour une raison propre :
 * chaque visite enregistre un clic d'affiliation, un robot qui les
 * parcourt fausserait les statistiques et déclencherait l'anti-fraude.
 *
 * ⚠ Toute entrée ajoutée ici doit l'être AUSSI dans `NOINDEX_SOURCES` de
 * next.config.mjs (en-tête `X-Robots-Tag`) — request-surface.test.ts vérifie
 * la correspondance.
 */
export const CRAWL_BLOCKED_PATHS = [
  "/dashboard",
  "/admin",
  "/api",
  "/affiliate",
  "/onboarding",
  "/auth",
  "/invite",
  "/r/",
] as const;

/**
 * Pages publiques mais sans intérêt à l'index : elles ne sont PAS bloquées
 * dans robots.txt, précisément pour que Google puisse lire leur `noindex`
 * (une page bloquée par robots.txt peut rester indexée « sans description »
 * si un lien externe pointe vers elle — le contraire de l'effet voulu).
 */
export const NOINDEX_ONLY_PATHS = ["/login", "/reset-password"] as const;

/**
 * Pages de la PLATEFORME que le routage par hôte rend aussi accessibles
 * sous le domaine de chaque commerçant (`boutique.exemple.com/tarifs`
 * affiche la page tarifs de Flexco). Sur un hôte tenant, elles ne doivent
 * pas être indexées : ce serait du contenu de la plateforme dupliqué sous
 * le nom de chaque boutique.
 */
export const PLATFORM_ONLY_PATHS = [
  "/tarifs",
  "/devenir-affilie",
  "/cgu",
  "/confidentialite",
  "/mentions-legales",
  "/signup",
] as const;

/** Pages marketing à déclarer dans le sitemap de la plateforme (les pages légales n'ont pas vocation à y figurer). */
export const MARKETING_SITEMAP_ENTRIES: readonly {
  path: string;
  priority: number;
  changeFrequency: "weekly" | "monthly";
}[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/tarifs", priority: 0.9, changeFrequency: "monthly" },
  { path: "/devenir-affilie", priority: 0.6, changeFrequency: "monthly" },
];

/** `/dashboard/:path*` (motif `source` de next.config.mjs) pour un préfixe de robots.txt. */
export function toHeaderSource(prefix: string): string {
  return `${prefix.replace(/\/$/, "")}/:path*`;
}
