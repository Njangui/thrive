-- ============================================================
-- 0071_ai_handoff_auto_resume.sql
--
-- (renommée depuis 0068_ai_handoff_auto_resume.sql lors de la fusion —
-- 0068-0070 étaient déjà pris par le chantier système financier, y
-- compris 0070_finance_category_compatibility.sql ajoutée à la fusion
-- flexco ×THRIVE du 23/09/2026)
--
-- Lot P — l'IA est active PAR DÉFAUT dans toute conversation, sans
-- réactivation manuelle. Deux colonnes support :
--
--   ai_config.human_pause_minutes : durée pendant laquelle l'IA se tait
--     après une réponse humaine avant de reprendre TOUTE SEULE au prochain
--     message du client (0 = elle ne se met jamais en pause). Réglable sur
--     /dashboard/ai — voir application/services/messaging-settings-service.ts.
--
--   conversations.human_takeover_at : horodatage du début de la pause
--     humaine en cours, pour calculer quand la relancer. Mis à jour à
--     chaque réponse manuelle (conversation-admin-service.ts::sendHumanReply
--     et ::takeOverConversation), effacé quand l'IA reprend
--     (handoff-service.ts::applyAutoResume /
--     conversation-admin-service.ts::returnConversationToAI).
--
-- Idempotente (`if not exists`), sans donnée à rétro-remplir : une
-- conversation déjà en 'human' sans human_takeover_at est traitée par
-- applyAutoResume() comme "pas de reprise automatique tant qu'aucun humain
-- n'a répondu APRÈS cette migration" (repli sur le dernier message humain,
-- voir handoff-service.ts::getHumanPauseStart) — comportement sûr, jamais
-- une reprise surprise sur une conversation en cours de traitement.
-- ============================================================

alter table ai_config
  add column if not exists human_pause_minutes integer not null default 15
    check (human_pause_minutes >= 0 and human_pause_minutes <= 10080); -- 7 jours max

alter table conversations
  add column if not exists human_takeover_at timestamptz;

comment on column ai_config.human_pause_minutes is
  'Lot P : minutes pendant lesquelles l''IA reste en pause après une réponse humaine avant de reprendre seule. 0 = jamais de pause.';
comment on column conversations.human_takeover_at is
  'Lot P : début de la pause humaine en cours (null = pas de prise en main active ou déjà reprise par l''IA).';
