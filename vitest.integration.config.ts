import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Config séparée de vitest.config.ts (qui exclut explicitement ce
// dossier) — voir tests/integration/tenant-isolation.test.ts pour le
// contexte complet. Volontairement pas de setupFiles ici : ce test ne
// mocke rien, il parle à un vrai Supabase.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
  },
});
