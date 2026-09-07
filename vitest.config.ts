import { defineConfig, configDefaults } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    // tests/integration/** est un test réseau réel contre une vraie
    // instance Supabase (voir son propre commentaire d'en-tête) — jamais
    // dans le pipeline `npm test` habituel, qui doit rester exécutable
    // sans instance réelle. Lancé séparément via `npm run test:integration`.
    // `configDefaults.exclude` repris explicitement : `test.exclude`
    // REMPLACE la liste par défaut de Vitest (node_modules, dist, ...)
    // plutôt que de s'y ajouter — l'omettre aurait accidentellement
    // réintégré node_modules dans la recherche de tests.
    exclude: [...configDefaults.exclude, "**/tests/integration/**"],
  },
});
