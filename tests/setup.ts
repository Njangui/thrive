/**
 * De nombreux fichiers de service importent `@/infrastructure/supabase/server-client`,
 * qui importe `@/lib/env` — lequel VALIDE (et plante) au chargement du
 * module si les variables d'environnement Supabase manquent. Pour pouvoir
 * tester les fonctions PURES colocalisées dans ces fichiers sans exiger un
 * vrai projet Supabase, on fournit des valeurs factices ici. Aucun test de
 * ce projet n'effectue réellement d'appel réseau vers ces URLs — les
 * fonctions testées sont soit pures, soit leurs dépendances DB sont
 * mockées (voir conversation-orchestrator.test.ts).
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test-placeholder.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

// Programme d'affiliation (0044) : secret de signature des jetons de
// cookie d'attribution — optionnel en prod (voir lib/env.ts), mais
// affiliate-link-security.test.ts a besoin d'une valeur déterministe
// pour signer/vérifier des jetons sans dépendre d'un vrai déploiement.
process.env.AFFILIATE_LINK_SECRET = "test-affiliate-link-secret";
