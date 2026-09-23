-- Vérification (LECTURE SEULE) : séparation messagerie WhatsApp / groupes WhatsApp.
-- À exécuter dans le SQL editor Supabase après déploiement du correctif du webhook Zernio.

-- 1. Groupes connectés mais JAMAIS activés : ils ne peuvent recevoir aucune diffusion.
--    Un groupe s'active dès qu'un premier message en provient (numéro DÉDIÉ aux groupes). Avant le correctif,
--    les événements de ce numéro étaient rejetés (« aucun tenant résolu ») : tous les groupes sont ici.
--    Le commerçant doit envoyer un message dans le groupe ; la ligne disparaît alors de cette liste.
select id, organization_id, name, connected_at
from whatsapp_groups
where status = 'connected' and zernio_conversation_id is null
order by connected_at;

-- 2. Fils de groupe présents dans la MESSAGERIE (conversations créées à tort comme des clients).
--    Attendu : 0 ligne. Si des lignes apparaissent, ne rien supprimer sans les avoir examinées.
select c.id as conversation_id, c.organization_id, c.external_thread_id, g.name as group_name, c.last_message_at, c.contact_id
from conversations c
join whatsapp_groups g on g.organization_id = c.organization_id and g.external_id = c.external_thread_id
where c.channel = 'whatsapp'
order by c.last_message_at desc;

-- 3. Numéros de messagerie connectés : chacun doit être routable par le webhook (ligne de whatsapp_accounts).
select organization_id, account_id, phone_number, is_primary, status
from whatsapp_accounts
order by organization_id, is_primary desc;

-- 4. Numéro dédié aux groupes : un compte Zernio DIFFÉRENT de tous ceux de la requête 3 (attendu : 0 ligne).
select pc.organization_id, pc.metadata->>'accountId' as groups_account_id
from provider_connections pc
join whatsapp_accounts wa on wa.organization_id = pc.organization_id and wa.account_id = pc.metadata->>'accountId'
where pc.provider_type = 'whatsapp_groups';
