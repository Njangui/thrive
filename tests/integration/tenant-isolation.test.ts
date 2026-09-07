/**
 * Test d'isolation multi-tenant RÉEL — exécuté contre une vraie instance
 * Supabase (pas de mock), avec de vrais utilisateurs authentifiés et de
 * vraies policies RLS Postgres. Volontairement séparé de `npm test`
 * (voir `package.json::test:integration` et `vitest.config.ts::exclude`)
 * — ce fichier ne doit JAMAIS tourner dans le pipeline habituel, qui doit
 * rester exécutable sans instance réelle.
 *
 * Scénario (cahier Lot O / section héritée du Lot 4/S) : deux
 * organisations A et B, un seul utilisateur authentifié, membre de A
 * UNIQUEMENT. On vérifie qu'aucune requête via ce client authentifié
 * (jamais le service-role, qui bypass la RLS par construction et ne
 * prouverait donc rien ici) ne peut lire ni écrire une ligne appartenant
 * à B, sur CHAQUE table tenant-scoped du projet.
 *
 * Prérequis pour lancer réellement ce fichier — un projet Supabase DÉDIÉ
 * aux tests (jamais le projet de production, jamais le projet de
 * développement partagé) :
 *
 *   SUPABASE_TEST_URL=https://xxxx.supabase.co
 *   SUPABASE_TEST_ANON_KEY=...
 *   SUPABASE_TEST_SERVICE_ROLE_KEY=...
 *
 *   npm run test:integration
 *
 * Sans ces 3 variables, TOUTE la suite est sautée (`describe.skipIf`) —
 * `npm test` (sans lien avec ce fichier) et `npm run test:integration`
 * sans configuration ne cassent jamais rien par accident.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_TEST_URL = process.env.SUPABASE_TEST_URL;
const SUPABASE_TEST_ANON_KEY = process.env.SUPABASE_TEST_ANON_KEY;
const SUPABASE_TEST_SERVICE_ROLE_KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;

const hasCredentials = Boolean(SUPABASE_TEST_URL && SUPABASE_TEST_ANON_KEY && SUPABASE_TEST_SERVICE_ROLE_KEY);

// Garde-fou explicite anti-production : si la même variable d'env que
// l'application (NEXT_PUBLIC_SUPABASE_URL) est présente dans ce process
// ET qu'elle pointe vers la même URL que SUPABASE_TEST_URL, quelqu'un a
// probablement copié/collé la mauvaise variable — refuse de tourner
// plutôt que de risquer d'écrire des lignes de test dans un projet réel.
const pointsAtAppEnv =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) && process.env.NEXT_PUBLIC_SUPABASE_URL === SUPABASE_TEST_URL;

const canRun = hasCredentials && !pointsAtAppEnv;

if (hasCredentials && pointsAtAppEnv) {
  // On le signale bruyamment plutôt que de sauter silencieusement — un
  // `skip` silencieux ici pourrait laisser croire que l'isolation a été
  // vérifiée alors que la suite entière n'a jamais tourné.
  // eslint-disable-next-line no-console
  console.error(
    "tests/integration/tenant-isolation.test.ts : SUPABASE_TEST_URL == NEXT_PUBLIC_SUPABASE_URL — " +
      "ça ressemble à l'URL de l'application (dev ou production), pas à un projet Supabase dédié aux " +
      "tests. Suite SAUTÉE par sécurité. Utilise un projet Supabase séparé pour SUPABASE_TEST_URL.",
  );
}

/** Une seule fonction générique par table : construit la ligne à insérer pour un org donné. */
interface TableSpec {
  table: string;
  /** Colonne qui identifie une ligne pour les vérifications ciblées — "id" pour presque toutes, "organization_id" pour les tables à ligne unique par org (ai_config, organization_landing_config). */
  idColumn: "id" | "organization_id";
  seed: (orgId: string, deps: Record<string, { id: string }>) => Record<string, unknown>;
  /** Nom dans `deps` sous lequel la ligne insérée pour CE tenant sera rangée, pour que les tables dépendantes puissent la référencer. */
  storeAs?: string;
}

let addonKeyForTest = "";
let recipientUserId = "";

// Ordre = ordre de dépendance (une table ne référence jamais une table
// listée après elle). `deps` ne contient que les lignes déjà insérées
// POUR LE MÊME organization_id dans cette liste.
const TABLE_SPECS: TableSpec[] = [
  { table: "categories", idColumn: "id", storeAs: "category", seed: (orgId) => ({ organization_id: orgId, name: "Catégorie isolation", slug: `cat-iso-${orgId.slice(0, 8)}` }) },
  { table: "products", idColumn: "id", storeAs: "product", seed: (orgId) => ({ organization_id: orgId, name: "Produit isolation", unit_price: 1000 }) },
  { table: "services", idColumn: "id", seed: (orgId) => ({ organization_id: orgId, name: "Service isolation", slug: `svc-iso-${orgId.slice(0, 8)}`, price: 5000 }) },
  { table: "contacts", idColumn: "id", storeAs: "contact", seed: (orgId) => ({ organization_id: orgId, full_name: "Contact isolation", phone_e164: `+2376${orgId.replace(/-/g, "").slice(0, 8)}` }) },
  { table: "leads", idColumn: "id", seed: (orgId, d) => ({ organization_id: orgId, contact_id: d.contact!.id }) },
  { table: "conversations", idColumn: "id", storeAs: "conversation", seed: (orgId, d) => ({ organization_id: orgId, contact_id: d.contact!.id, channel: "whatsapp" }) },
  { table: "messages", idColumn: "id", seed: (orgId, d) => ({ organization_id: orgId, conversation_id: d.conversation!.id, direction: "inbound", sender: "contact", content: "Message isolation" }) },
  { table: "orders", idColumn: "id", storeAs: "order", seed: (orgId, d) => ({ organization_id: orgId, contact_id: d.contact!.id }) },
  { table: "order_items", idColumn: "id", seed: (orgId, d) => ({ organization_id: orgId, order_id: d.order!.id, label: "Article isolation", unit_price: 1000, quantity: 1 }) },
  { table: "revenues", idColumn: "id", seed: (orgId) => ({ organization_id: orgId, amount: 1000 }) },
  { table: "expenses", idColumn: "id", seed: (orgId) => ({ organization_id: orgId, amount: 500 }) },
  { table: "notifications", idColumn: "id", seed: (orgId) => ({ organization_id: orgId, recipient_user_id: recipientUserId, title: "Notif isolation", body: "Test" }) },
  { table: "social_posts", idColumn: "id", storeAs: "post", seed: (orgId) => ({ organization_id: orgId, content: "Post isolation" }) },
  { table: "social_post_targets", idColumn: "id", seed: (orgId, d) => ({ organization_id: orgId, post_id: d.post!.id, platform: "facebook", provider_account_id: "acct-test" }) },
  { table: "whatsapp_groups", idColumn: "id", storeAs: "group", seed: (orgId) => ({ organization_id: orgId, external_id: `ext-iso-${orgId.slice(0, 8)}`, name: "Groupe isolation" }) },
  { table: "group_broadcasts", idColumn: "id", storeAs: "broadcast", seed: (orgId) => ({ organization_id: orgId, scheduled_at: new Date(Date.now() + 3_600_000).toISOString() }) },
  { table: "group_broadcast_targets", idColumn: "id", seed: (orgId, d) => ({ organization_id: orgId, broadcast_id: d.broadcast!.id, group_id: d.group!.id }) },
  { table: "group_broadcast_products", idColumn: "id", seed: (orgId, d) => ({ organization_id: orgId, broadcast_id: d.broadcast!.id, product_id: d.product!.id }) },
  { table: "testimonials", idColumn: "id", seed: (orgId) => ({ organization_id: orgId, author_name: "Client isolation", content: "Très content" }) },
  { table: "provider_connections", idColumn: "id", seed: (orgId) => ({ organization_id: orgId, provider_type: "ai", provider_name: `test-${orgId.slice(0, 8)}` }) },
  { table: "team_invitations", idColumn: "id", seed: (orgId) => ({ organization_id: orgId, email: `invite-${orgId.slice(0, 8)}@example.com`, role: "employee", token: `${orgId}-token-${Date.now()}`, expires_at: new Date(Date.now() + 3_600_000).toISOString() }) },
  { table: "tenant_domains", idColumn: "id", seed: (orgId) => ({ organization_id: orgId, domain: `test-iso-${orgId.slice(0, 8)}.example.com` }) },
  { table: "organization_addons", idColumn: "id", seed: (orgId) => ({ organization_id: orgId, addon_key: addonKeyForTest, quantity: 1 }) },
  // PK = organization_id, pas de colonne `id` distincte — vérifiées à part (voir plus bas).
  { table: "ai_config", idColumn: "organization_id", seed: (orgId) => ({ organization_id: orgId }) },
  { table: "organization_landing_config", idColumn: "organization_id", seed: (orgId) => ({ organization_id: orgId }) },
];

describe.skipIf(!canRun)("Isolation multi-tenant (Supabase réel)", () => {
  let serviceClient: SupabaseClient;
  let orgAClient: SupabaseClient; // authentifié, membre de A UNIQUEMENT
  let orgAId: string;
  let orgBId: string;
  let testUserId: string;
  const testEmail = `isolation-test-${Date.now()}@example.com`;
  const testPassword = `Iso-${Date.now()}-Test!`;

  // ligne insérée par table, par org : rows[table][orgLabel] = { id, organization_id }
  const rows: Record<string, { A: { id: string }; B: { id: string } }> = {};

  beforeAll(async () => {
    serviceClient = createClient(SUPABASE_TEST_URL!, SUPABASE_TEST_SERVICE_ROLE_KEY!);

    const { data: orgA, error: orgAError } = await serviceClient
      .from("organizations")
      .insert({ name: "Isolation Test Org A", slug: `isolation-test-a-${Date.now()}`, is_demo: true })
      .select("id")
      .single();
    if (orgAError || !orgA) throw new Error(`Setup org A échoué: ${orgAError?.message}`);
    orgAId = orgA.id as string;

    const { data: orgB, error: orgBError } = await serviceClient
      .from("organizations")
      .insert({ name: "Isolation Test Org B", slug: `isolation-test-b-${Date.now()}`, is_demo: true })
      .select("id")
      .single();
    if (orgBError || !orgB) throw new Error(`Setup org B échoué: ${orgBError?.message}`);
    orgBId = orgB.id as string;

    const { data: userData, error: userError } = await serviceClient.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    });
    if (userError || !userData.user) throw new Error(`Setup utilisateur test échoué: ${userError?.message}`);
    testUserId = userData.user.id;
    recipientUserId = testUserId; // seed notifications — voir TABLE_SPECS

    // Membre de A UNIQUEMENT — jamais de membership sur B, c'est tout le test.
    const { error: membershipError } = await serviceClient
      .from("memberships")
      .insert({ organization_id: orgAId, user_id: testUserId, role: "owner" });
    if (membershipError) throw new Error(`Setup membership échoué: ${membershipError.message}`);

    // Add-on de référence (table globale, pas tenant-scoped) pour pouvoir
    // insérer une ligne organization_addons valide sans dépendre d'un
    // seed déjà présent dans le projet Supabase de test.
    addonKeyForTest = `isolation_test_addon_${Date.now()}`;
    const { error: addonError } = await serviceClient
      .from("addons")
      .insert({ key: addonKeyForTest, name: "Add-on test isolation", price_fcfa: 0 });
    if (addonError) throw new Error(`Setup addon de référence échoué: ${addonError.message}`);

    const anonForSignIn = createClient(SUPABASE_TEST_URL!, SUPABASE_TEST_ANON_KEY!);
    const { data: session, error: signInError } = await anonForSignIn.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    });
    if (signInError || !session.session) throw new Error(`Connexion utilisateur test échouée: ${signInError?.message}`);

    // Client scopé à la session réelle de l'utilisateur — c'est LUI qui
    // porte les policies RLS (`auth.uid()` côté Postgres), jamais le
    // service-role au-delà du setup ci-dessus.
    orgAClient = createClient(SUPABASE_TEST_URL!, SUPABASE_TEST_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
    });

    // Seed : une ligne par table, pour A et pour B, dans l'ordre de
    // dépendance de TABLE_SPECS (service-role — le but ici est de
    // préparer les données, pas de tester l'écriture).
    const depsA: Record<string, { id: string }> = {};
    const depsB: Record<string, { id: string }> = {};

    for (const spec of TABLE_SPECS) {
      const targets: { label: "A" | "B"; orgId: string; deps: Record<string, { id: string }> }[] = [
        { label: "A", orgId: orgAId, deps: depsA },
        { label: "B", orgId: orgBId, deps: depsB },
      ];
      for (const { label, orgId, deps } of targets) {
        const payload = spec.seed(orgId, deps);
        const { data, error } = await serviceClient.from(spec.table).insert(payload).select(spec.idColumn).single();
        if (error || !data) {
          throw new Error(`Seed ${spec.table} (org ${label}) échoué: ${error?.message}`);
        }
        const insertedId = (data as Record<string, string>)[spec.idColumn];
        if (!insertedId) {
          throw new Error(`Seed ${spec.table} (org ${label}) : ${spec.idColumn} manquant dans la ligne insérée`);
        }
        const row = { id: insertedId };
        rows[spec.table] ??= { A: { id: "" }, B: { id: "" } };
        rows[spec.table]![label] = row;
        if (spec.storeAs) deps[spec.storeAs] = row;
      }
    }
  }, 60_000);

  afterAll(async () => {
    // `on delete cascade` sur organization_id nettoie tout le reste —
    // supprimer les 2 organisations suffit, plus le user et l'add-on de
    // référence qui n'en dépendent pas.
    if (orgAId) await serviceClient.from("organizations").delete().eq("id", orgAId);
    if (orgBId) await serviceClient.from("organizations").delete().eq("id", orgBId);
    if (addonKeyForTest) await serviceClient.from("addons").delete().eq("key", addonKeyForTest);
    if (testUserId) await serviceClient.auth.admin.deleteUser(testUserId);
  });

  it("le seed a bien préparé une ligne A et une ligne B pour chaque table", () => {
    for (const spec of TABLE_SPECS) {
      expect(rows[spec.table]?.A.id, `${spec.table} (A)`).toBeTruthy();
      expect(rows[spec.table]?.B.id, `${spec.table} (B)`).toBeTruthy();
    }
  });

  describe.each(TABLE_SPECS)("$table", (spec) => {
    it("lecture — la ligne de B n'apparaît jamais dans une liste large", async () => {
      const { data, error } = await orgAClient.from(spec.table).select(spec.idColumn).limit(1000);
      expect(error, `select ${spec.table} ne devrait pas errorer (RLS filtre, ne bloque pas)`).toBeNull();
      const ids = (data ?? []).map((r) => (r as Record<string, string>)[spec.idColumn]);
      expect(ids).not.toContain(rows[spec.table]!.B.id);
    });

    it("lecture ciblée — impossible de lire la ligne de B en la visant par son id", async () => {
      const { data } = await orgAClient.from(spec.table).select(spec.idColumn).eq(spec.idColumn, rows[spec.table]!.B.id).maybeSingle();
      expect(data, `${spec.table} : la ligne de B a été lue par le client de A`).toBeNull();
    });

    it("écriture — impossible de modifier la ligne de B", async () => {
      const { data, error } = await orgAClient
        .from(spec.table)
        .update({ organization_id: orgBId }) // no-op métier, mais force une tentative d'UPDATE réelle
        .eq(spec.idColumn, rows[spec.table]!.B.id)
        .select(spec.idColumn);
      // RLS : soit l'update est silencieusement filtré (0 ligne affectée),
      // soit il est explicitement rejeté (erreur) — les deux sont des
      // preuves d'isolation valables, seul un succès avec ligne(s)
      // affectée(s) serait un échec du test.
      if (!error) {
        expect(data ?? []).toHaveLength(0);
      }
    });

    it("écriture — impossible de créer une ligne pour B en usurpant organization_id", async () => {
      const impersonated = { ...spec.seed(orgBId, rows_as_deps_for(spec, rows)), organization_id: orgBId };
      const { data, error } = await orgAClient.from(spec.table).insert(impersonated).select(spec.idColumn);
      // Là aussi, un rejet explicite (violation RLS) ou une insertion qui
      // ne renvoie rien sont deux preuves valables ; seule une insertion
      // qui réussit ET renvoie une ligne est un échec réel.
      if (!error) {
        expect(data ?? [], `${spec.table} : insertion pour B réussie via le client de A`).toHaveLength(0);
      }
    });
  });
});

/**
 * Les tables dépendantes (leads, messages, order_items...) ont besoin de
 * `deps` pour reconstruire un payload d'insertion cohérent dans le test
 * d'usurpation ci-dessus — on réutilise les lignes déjà seedées pour B
 * plutôt que d'en re-créer de nouvelles pour ce seul test.
 */
function rows_as_deps_for(
  spec: TableSpec,
  rows: Record<string, { A: { id: string }; B: { id: string } }>,
): Record<string, { id: string }> {
  const deps: Record<string, { id: string }> = {};
  for (const other of TABLE_SPECS) {
    if (other.storeAs && rows[other.table]) deps[other.storeAs] = rows[other.table]!.B;
  }
  return deps;
}
