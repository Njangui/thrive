/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOTE (Phase 2 - Custom Domains, section 23):
  // Le routing tenant-aware par sous-domaine / domaine custom est géré dans
  // src/middleware.ts, pas ici. Ne rien coder ici qui suppose un tenant unique.
  eslint: {
    ignoreDuringBuilds: false,
  },
  experimental: {
    // Par défaut, Next.js 14 refuse tout corps de Server Action > 1 Mo
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
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/**" },
      { protocol: "https", hostname: "picsum.photos" },
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
  // `src/middleware.ts`, propagée automatiquement par Next.js aux scripts
  // qu'il injecte) supprimerait ce compromis mais demande des tests
  // approfondis en conditions réelles avant d'être activée — pas fait ici,
  // documenté pour une prochaine itération. Ce CSP reste une réduction
  // réelle de la surface XSS (bloque tout script/style chargé depuis un
  // domaine tiers non listé), pas une protection parfaite.
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://*.supabase.co https://picsum.photos",
      "font-src 'self'",
      // `connect-src` doit inclure Supabase : le client navigateur
      // (browser-client.ts) appelle directement `https://<projet>.supabase.co`
      // (Auth + REST) depuis le front — un domaine différent de l'origine
      // de l'app. Sans cette entrée, CSP bloque silencieusement CHAQUE appel
      // fetch vers Supabase émis depuis le navigateur (login, signup, reset
      // password...), qui échoue côté JS avec `TypeError: Failed to fetch` —
      // pas une erreur réseau, un blocage CSP. `wss://*.supabase.co` non
      // ajouté : Supabase Realtime (websocket) n'est utilisé nulle part dans
      // le projet actuellement — à ajouter si un futur lot l'introduit.
      //
      // Vidéos catalogue (Zernio) : le navigateur envoie le fichier
      // DIRECTEMENT vers l'URL présignée renvoyée par Zernio (un `PUT`
      // `fetch`/XHR — d'où `connect-src`), sans repasser par une fonction
      // Vercel (limite de 4,5 Mo par requête, incompatible avec une
      // vidéo). Hôtes VÉRIFIÉS dans la doc Zernio (guide « Media Uploads »):
      // l'URL présignée pointe vers `<bucket>.r2.cloudflarestorage.com`
      // (Cloudflare R2) et l'URL publique vers `media.zernio.com`.
      "connect-src 'self' https://*.supabase.co https://media.zernio.com https://*.r2.cloudflarestorage.com",
      // Lecture des vidéos catalogue (Zernio), des messages vocaux/audios
      // (Supabase Storage) et de l'aperçu d'un vocal en cours d'envoi
      // (`blob:`). Sans cette directive, `default-src 'self'` bloque
      // tout <video>/<audio> externe.
      "media-src 'self' blob: https://*.supabase.co https://media.zernio.com",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; ");

    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
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
    ];
  },
};

export default nextConfig;
