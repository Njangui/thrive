import { defineConfig } from "vitest/config";

// Config séparée de vitest.config.mts (qui exclut explicitement ce
// dossier) — voir tests/integration/tenant-isolation.test.ts pour le
// contexte complet. Volontairement pas de setupFiles ici : ce test ne
// mocke rien, il parle à un vrai Supabase.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
  },
});
