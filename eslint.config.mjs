import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Convention du projet : un paramètre préfixé `_` est volontairement inutilisé
      // (signature imposée par un port/une interface).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
      // Règles « React Compiler » d'eslint-plugin-react-hooks v7 (activées par défaut dans
      // eslint-config-next 16). Laissées en AVERTISSEMENT pour le code futur : les cas
      // légitimes existants sont exemptés fichier par fichier ci-dessous, avec leur raison.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/error-boundaries": "warn",
    },
  },
  {
    // Synchronisation avec un système EXTERNE après le montage (localStorage, API du navigateur,
    // fuseau horaire local, polling réseau). Le setState dans l'effet est ici le seul moyen de
    // lire ces sources sans provoquer d'écart d'hydratation SSR/client.
    files: [
      "src/app/_components/promotion-deadline-field.tsx",
      "src/app/dashboard/_components/install-app-banner.tsx",
      "src/app/dashboard/_components/notification-watcher.tsx",
      "src/app/dashboard/notifications/push-toggle.tsx",
    ],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
  {
    // `Date.now()` volontairement évalué à chaque rendu : « maintenant » pour une publication
    // immédiate, `min` d'un champ datetime-local, fenêtre glissante de 30 jours (Server
    // Component exécuté une fois par requête). La figer au montage donnerait des valeurs périmées.
    files: [
      "src/app/dashboard/analytics/page.tsx",
      "src/app/dashboard/marketing/omnichannel-publication-composer.tsx",
      "src/app/dashboard/marketing/telegram-publication-composer.tsx",
    ],
    rules: { "react-hooks/purity": "off" },
  },
  {
    // Vignette 64 px d'une URL produit arbitraire (Supabase ou externe) dans un formulaire du
    // dashboard : next/image exigerait un `remotePatterns` par hôte et casserait sur un hôte inconnu.
    files: ["src/app/dashboard/marketing/omnichannel-publication-composer.tsx"],
    rules: { "@next/next/no-img-element": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "tsconfig.tsbuildinfo"]),
]);
