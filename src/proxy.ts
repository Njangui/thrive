import { NextResponse, type NextRequest } from "next/server";

/**
 * Résolution tenant par hostname (section 23) :
 *  - tenant.sme-os.app         -> slug = "tenant"
 *  - client-custom-domain.com  -> lookup dans `tenant_domains` (TODO Phase 6)
 *
 * On ne fait QUE l'extraction ici et on la propage via un header interne ;
 * la résolution effective en organization_id se fait dans un layout/server
 * component qui a accès à Supabase (ce fichier s'exécute avant CHAQUE
 * requête : un accès DB ici ajouterait sa latence à toutes — voir
 * docs/tenancy.md).
 *
 * Volontairement PAS basé sur un ?tenant= en query string (section 23 :
 * "ne pas coder une solution fragile basée uniquement sur des paramètres URL").
 *
 * Rate limiting (voir src/lib/rate-limit.ts) : PAS branché ici. Sous Next 14
 * ce fichier (alors `middleware.ts`) tournait en Edge Runtime, où
 * @upstash/redis échouait (process.version, API Node.js absente). Depuis
 * Next 16 (`proxy.ts`), le runtime par défaut est Node.js — la contrainte
 * technique a disparu, mais la raison de fond reste : une défaillance ici
 * bloquerait TOUTE requête, pas seulement le rate limiting. Il reste donc
 * branché directement dans les route handlers et Server Actions concernés
 * (/api/webhooks/fapshi/route.ts via webhook-pipeline.ts, actions publiques de vitrine). Le
 * webhook Zernio (/api/webhooks/zernio/route.ts) n'a volontairement pas été
 * touché : il appartient au périmètre du Lot 3.
 */
export function proxy(request: NextRequest) {
  const hostname = request.headers.get("host") ?? "";
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

  const requestHeaders = new Headers(request.headers);

  // Repasse sécurité P0 (07/09/2026, section 8/9 de la mission) :
  // `new Headers(request.headers)` clone TOUS les headers entrants, y
  // compris ceux qu'un client aurait pu forger lui-même. Avant ce
  // correctif, ces deux headers n'étaient écrasés QUE dans les branches
  // subdomain/domaine-custom ci-dessous — sur le domaine racine
  // (aucune des deux branches ne s'exécute), un `x-tenant-slug` forgé
  // par le client survivait tel quel jusqu'à `resolveRequestTenant()`,
  // qui l'utilise pour choisir QUEL tenant afficher sur `/` (voir
  // page.tsx : bascule entre TenantLanding et MarketingLanding). Un
  // visiteur du domaine racine pouvait ainsi forcer l'affichage de la
  // vitrine publique d'une AUTRE organisation à cet endroit — jamais de
  // données privées (resolveRequestTenant() ne sert que du contenu déjà
  // public sur le domaine du tenant), mais un contournement réel du
  // routage par hostname, jamais voulu. Suppression inconditionnelle
  // AVANT toute logique conditionnelle : aucun chemin ne peut plus
  // laisser passer une valeur fournie par le client.
  requestHeaders.delete("x-tenant-slug");
  requestHeaders.delete("x-tenant-custom-domain");

  if (hostname !== rootDomain && hostname.endsWith(`.${rootDomain}`)) {
    // Sous-domaine plateforme : tenant.sme-os.app
    const subdomain = hostname.replace(`.${rootDomain}`, "");
    requestHeaders.set("x-tenant-slug", subdomain);
  } else if (hostname !== rootDomain) {
    // Domaine custom potentiel - la résolution réelle vers organization_id
    // via tenant_domains se fait côté serveur (Phase 6), pas ici.
    requestHeaders.set("x-tenant-custom-domain", hostname);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    /*
     * Exclure les assets statiques et les routes internes Next.js pour ne
     * pas alourdir chaque requête.
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
