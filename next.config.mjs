/**
 * Surfaces qui ne doivent JAMAIS figurer dans un index de recherche :
 * authentifiées (dashboard, admin, affiliation), techniques (api, auth,
 * invitation) ou à effet de bord (`/r/` : chaque visite enregistre un clic
 * d'affiliation). Envoyé en en-tête `X-Robots-Tag` — filet de sécurité
 * derrière robots.txt : `Disallow` interdit l'EXPLORATION mais pas
 * l'indexation d'une URL découverte par un lien externe.
 *
 * `/login` et `/reset-password` sont publics et explorables (robots.txt ne
 * les bloque pas, exprès : Google doit pouvoir lire ce `noindex`).
 *
 * ⚠ Ces motifs sont recopiés de `CRAWL_BLOCKED_PATHS` / `NOINDEX_ONLY_PATHS`
 * (src/lib/request-surface.ts) — ce fichier ne peut pas importer du
 * TypeScript. src/lib/request-surface.test.ts échoue si les deux divergent.
 */
const NOINDEX_SOURCES = [
  "/dashboard/:path*",
  "/admin/:path*",
  "/api/:path*",
  "/affiliate/:path*",
  "/onboarding/:path*",
  "/auth/:path*",
  "/invite/:path*",
  "/r/:path*",
  "/login",
  "/reset-password",
];

/**
 * Domaine public des médias Cloudflare R2 (C4), lu depuis R2_PUBLIC_BASE_URL.
 * INDISPENSABLE avant STORAGE_PROVIDER=r2 : sans lui, `next/image` refuse le
 * domaine ET le CSP `img-src` / `media-src` bloque les fichiers — toutes les
 * images enverraient une erreur. Lu à la construction : la variable doit donc
 * exister AU BUILD (Vercel : variables d'environnement du projet), pas
 * seulement à l'exécution. Absente ou invalide : aucun changement.
 */
function r2MediaOrigin() {
  const raw = process.env.R2_PUBLIC_BASE_URL;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
const R2_MEDIA = r2MediaOrigin();

/** Hôte du projet Supabase (audit QA3/SEC1) : plus de `*.supabase.co` — les images et la CSP se limitent à NOTRE projet. */
function supabaseHost() {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return url.protocol === "https:" ? url.hostname : null;
  } catch {
    return null;
  }
}
const SUPABASE_HOST = supabaseHost();

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Ne pas annoncer « X-Powered-By: Next.js » à chaque réponse.
  poweredByHeader: false,
  // Lecture des classeurs Excel (import de catalogue, C4) : paquet volumineux, chargé tel quel par Node plutôt qu'empaqueté.
  serverExternalPackages: ["exceljs"],
  // Même hôte que `images.remotePatterns`, rendu lisible côté navigateur et
  // serveur par `isOptimizableImageUrl` (src/lib/optimizable-image.ts).
  env: R2_MEDIA ? { NEXT_PUBLIC_R2_MEDIA_HOST: R2_MEDIA.hostname } : {},
  // NOTE (Phase 2 - Custom Domains, section 23):
  // Le routing tenant-aware par sous-domaine / domaine custom est géré dans
  // src/proxy.ts (ex-middleware.ts, renommé par Next.js 16), pas ici. Ne rien
  // coder ici qui suppose un tenant unique.
  experimental: {
    // Par défaut, Next.js refuse tout corps de Server Action > 1 Mo
    // ("Body exceeded 1MB limit") — ce qui bloquait l'envoi de pièces
    // jointes/vocaux depuis la messagerie (et les photos produit > 1 Mo).
    // 4 Mo reste sous la limite de 4,5 Mo par requête des fonctions Vercel :
    // au-delà, l'envoi échouerait de toute façon côté plateforme. Les
    // vidéos (bien plus lourdes) ne passent PAS par ici : elles partent
    // directement du navigateur vers Zernio (voir video-upload-field).
    serverActions: { bodySizeLimit: "4mb" },
  },
  images: {
    // Nécessaire pour `next/image` sur les photos produits/logos/bannières
    // stockées dans le bucket Supabase `tenant-media` (voir docs/DEPLOYMENT.md
    // section 1) — sans ça, Next.js refuse de servir une image dont le
    // domaine n'est pas explicitement autorisé. `picsum.photos` ne sert
    // qu'aux images placeholder de `scripts/seed-demo.ts` — à retirer une
    // fois la démo remplacée par de vraies photos produit en production.
    remotePatterns: [
      ...(SUPABASE_HOST ? [{ protocol: "https", hostname: SUPABASE_HOST, pathname: "/storage/v1/object/public/**" }] : []),
      { protocol: "https", hostname: "picsum.photos" },
      ...(R2_MEDIA ? [{ protocol: "https", hostname: R2_MEDIA.hostname }] : []),
    ],
  },
  // Headers de sécurité — absents jusqu'ici (voir COMPARAISON_MASTER_PROMPT.md,
  // section "Avant toute mise en production réelle"). S'appliquent à TOUTES
  // les routes, y compris les domaines custom des tenants (le routing
  // tenant-aware ne change rien à la politique de sécurité — une seule
  // politique cohérente pour tout le produit).
  //
  // `script-src` inclut `'unsafe-inline'` : Next.js App Router injecte un
  // `<script>` inline pour l'hydratation (`__NEXT_DATA__`) — un CSP strict
  // sans ce mot-clé le bloquerait. Une politique par nonce (générée dans
  // `src/proxy.ts`, propagée automatiquement par Next.js aux scripts
  // qu'il injecte) supprimerait ce compromis mais demande des tests
  // approfondis en conditions réelles avant d'être activée — pas fait ici,
  // documenté pour une prochaine itération. Ce CSP reste une réduction
  // réelle de la surface XSS (bloque tout script/style chargé depuis un
  // domaine tiers non listé), pas une protection parfaite.
  async headers() {
    // CSP statique (copie de src/lib/csp.ts::buildCsp, test de non-divergence : src/lib/csp.test.ts).
    // En mode nonce (CSP_NONCE=true) la CSP est posée par src/proxy.ts : on ne l'émet pas ici.
    const sb = SUPABASE_HOST ? ` https://${SUPABASE_HOST}` : "";
    const r2 = R2_MEDIA ? ` ${R2_MEDIA.origin}` : "";
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' data:${sb} https://picsum.photos${r2}`,
      "font-src 'self'",
      // `connect-src` : le navigateur appelle directement Supabase (Auth + REST) et envoie les vidéos
      // catalogue vers Zernio/R2 (URL présignée) — hôtes vérifiés dans la doc Zernio (« Media Uploads »).
      `connect-src 'self'${sb} https://media.zernio.com https://*.r2.cloudflarestorage.com`,
      // Lecture des vidéos catalogue, des vocaux et de l'aperçu d'un vocal en cours d'envoi (`blob:`).
      `media-src 'self' blob:${sb} https://media.zernio.com${r2}`,
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          ...(process.env.CSP_NONCE === "true" ? [] : [{ key: "Content-Security-Policy", value: csp }]),
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // `microphone=(self)` : l'enregistrement d'un message vocal depuis
          // la messagerie (getUserMedia) est bloqué par le navigateur si
          // la politique interdit le micro à l'origine elle-même — avec
          // l'ancienne valeur `microphone=()`, le bouton vocal ne pouvait
          // tout simplement pas fonctionner.
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
          // `preload` volontairement omis : soumettre un domaine à la liste
          // de préchargement HSTS des navigateurs est difficile à annuler
          // ensuite — décision à prendre explicitement plus tard, pas ici.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
      ...NOINDEX_SOURCES.map((source) => ({
        source,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
    ];
  },
};

export default nextConfig;
