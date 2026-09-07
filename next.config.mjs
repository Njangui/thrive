/** @type {import('next').NextConfig} */
const nextConfig = {
  // NOTE (Phase 2 - Custom Domains, section 23):
  // Le routing tenant-aware par sous-domaine / domaine custom est géré dans
  // src/middleware.ts, pas ici. Ne rien coder ici qui suppose un tenant unique.
  eslint: {
    ignoreDuringBuilds: false,
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
      "connect-src 'self'",
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
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
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
