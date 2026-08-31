-- ------------------------------------------------------------
-- Lot D — Mémoire conversationnelle courte (section 21/24 master
-- prompt) : mémorise les derniers produits mentionnés par conversation,
-- pour que l'IA comprenne une référence comme "celle à 25 000" sans
-- qu'on lui envoie tout l'historique des messages (rejeté explicitement
-- par le master prompt). Volontairement pas de table séparée — un
-- tableau borné (3 max, imposé en application layer, voir
-- conversation-memory-service.ts) suffit pour ce besoin V1.
-- ------------------------------------------------------------
alter table conversations add column last_mentioned_product_ids uuid[] not null default '{}';
