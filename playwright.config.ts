import { defineConfig, devices } from "@playwright/test";

/**
 * Tests end-to-end (navigateur réel, pas de mock) — séparés des tests
 * unitaires (`vitest run`, `src/**\/*.test.ts`) et des tests d'intégration
 * DB (`vitest run --config vitest.integration.config.ts`,
 * `tests/integration/**`). Trois couches distinctes, trois commandes
 * distinctes, cohérent avec la séparation déjà en place dans ce projet.
 *
 * PRÉREQUIS pour lancer réellement cette suite (comme pour
 * `test:integration`, voir tests/integration/tenant-isolation.test.ts) :
 * un fichier `.env.local` avec de vraies variables Supabase
 * (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY) — l'app ne rend rien d'utile sans ça, donc
 * ces tests non plus. `webServer` ci-dessous lance `npm run dev` et
 * attend que le serveur réponde avant de commencer.
 *
 * Non exécutée dans l'environnement où ce fichier a été écrit : le
 * téléchargement du binaire navigateur Playwright
 * (`npx playwright install chromium`) nécessite un accès réseau à
 * `cdn.playwright.dev`, bloqué dans ce bac à sable. Écrite et
 * typecheckée (`npm run typecheck` la couvre, `**\/*.ts` inclut ce
 * dossier), jamais exécutée ici — à lancer une première fois dans un
 * environnement avec accès réseau complet avant de faire confiance aux
 * résultats.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 13"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
