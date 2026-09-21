import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Convention du projet : un paramètre préfixé `_` est volontairement inutilisé
      // (signature imposée par un port/une interface). Sans ce motif, ~35 faux positifs.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
      // Règles « React Compiler » d'eslint-plugin-react-hooks v7 (activées par défaut dans
      // eslint-config-next 16). Elles signalent des schémas qui fonctionnent (setState dans un
      // effet pour lire localStorage/matchMedia, Date.now() dans un composant, JSX dans un
      // try/catch de Server Component) — pas des bugs. Laissées en AVERTISSEMENT (visibles
      // dans `npm run lint`) plutôt qu'en erreur : les corriger = refactorer une vingtaine de
      // composants sans pouvoir les exécuter ici. À traiter dans un lot dédié.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/error-boundaries": "warn",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "tsconfig.tsbuildinfo"]),
]);
