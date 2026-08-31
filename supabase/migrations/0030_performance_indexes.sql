-- ============================================================
-- 0030_performance_indexes.sql
-- Optimisation (hors vague de lots F-J) — voir RAPPORT_OPTIMISATION.md
-- à la racine du projet pour le détail de chaque requête concernée.
--
-- Numérotée volontairement à 0030, PAS dans la plage 0018-0026 déjà
-- assignée aux cahiers des Lots F à J (voir 00_CONVENTIONS_COMMUNES_V2.md)
-- pour ne provoquer aucune collision avec leurs migrations quand elles
-- reviendront — un trou dans la séquence n'est jamais un problème
-- (convention déjà établie), une vraie collision de numéro l'est.
--
-- Aucune de ces 5 lignes ne change un comportement : ce sont des index
-- supplémentaires sur des tables/colonnes déjà interrogées par du code
-- existant, jamais une contrainte nouvelle.
-- ============================================================

-- 1. `/dashboard/products` (privé) ET `/produits` (vitrine publique)
--    paginent désormais par page= (organization_id + filtre status +
--    tri — voir requêtes exactes ci-dessous) — sans un index adapté,
--    Postgres devait trier/filtrer en mémoire après avoir isolé
--    l'organisation, ce qui annulait une bonne partie du bénéfice de la
--    pagination elle-même.
--    - dashboard : eq(organization_id) + order(created_at desc) + range()
create index idx_products_org_created on products(organization_id, created_at desc);
--    - vitrine publique : eq(organization_id) + eq(status) + order(name) + range()
create index idx_products_org_status_name on products(organization_id, status, name);

-- 2. `listConversationsForOrg()` (conversation-admin-service.ts) : filtre
--    par organisation, trie par last_message_at desc, limit 50 — seul
--    idx_conversations_org(organization_id) existait, sans la colonne de
--    tri.
create index idx_conversations_org_last_message
  on conversations(organization_id, last_message_at desc);

-- 3. La "dernière activité" affichée dans la console Super Admin
--    (admin-organizations-service.ts::listOrganizationsForAdmin) scanne
--    les messages RÉCENTS TOUS TENANTS CONFONDUS (pas de filtre par
--    organisation) — un index partiel sur last_message_at seul sert
--    spécifiquement cette requête-là, distincte de la n°2 ci-dessus.
create index idx_conversations_last_message_not_null
  on conversations(last_message_at desc)
  where last_message_at is not null;

-- 4. `admin-organizations-service.ts` et `admin-channels-service.ts`
--    filtrent `provider_connections` par statut à travers tous les
--    tenants (ex: status = 'connected') — l'index composite existant sur
--    (organization_id, provider_type, provider_name) ne sert pas cette
--    requête, `status` n'en est pas la colonne de tête.
create index idx_provider_connections_status on provider_connections(status);

-- 5. `admin-overview-service.ts` compte les messages `sender = 'ai'` sur
--    30 jours, tous tenants confondus (pas filtré par conversation_id) —
--    idx_messages_conversation(conversation_id, created_at) ne sert pas
--    cette requête globale.
create index idx_messages_sender_created on messages(sender, created_at);
