import { NextResponse, type NextRequest } from "next/server";

/**
 * Résolution tenant par hostname (section 23) :
 *  - tenant.sme-os.app         -> slug = "tenant"
 *  - client-custom-domain.com  -> lookup dans `tenant_domains` (TODO Phase 6)
 *
 * On ne fait QUE l'extraction ici et on la propage via un header interne ;
 * la résolution effective en organization_id se fait dans un layout/server
 * component qui a accès à Supabase (le middleware Edge n'a pas toujours
 * un accès DB pratique/rapide — voir docs/tenancy.md).
 *
 * Volontairement PAS basé sur un ?tenant= en query string (section 23 :
 * "ne pas coder une solution fragile basée uniquement sur des paramètres URL").
 *
 * Rate limiting (voir src/lib/rate-limit.ts) : PAS branché ici. Ce fichier
 * tourne en Edge Runtime (imposé par Next.js pour tout middleware), et
 * @upstash/redis tire une dépendance qui utilise process.version (API
 * Node.js absente du runtime Edge — averti au build : "A Node.js API is
 * used ... which is not supported in the Edge Runtime"). Une défaillance
 * ici bloquerait TOUTE requête, pas seulement le rate limiting. Branché
 * à la place directement dans les route handlers concernés
 * (/api/webhooks/notchpay/route.ts, runtime Node.js par défaut) — voir
 * son propre commentaire. Le webhook Zernio (/api/webhooks/zernio/route.ts)
 * n'a volontairement pas été touché : il appartient au périmètre du
 * Lot 3, en cours ailleurs au moment de cet ajout.
 */
export function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") ?? "";
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

  const requestHeaders = new Headers(request.headers);

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
