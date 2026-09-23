# Lot P — Messagerie automatique et semi-automatique

Audit demandé après un test WhatsApp réel : le premier message n'a reçu
aucune réaction, puis dès que l'IA a été activée manuellement, elle s'est
de nouveau arrêtée sur « présentez-moi vos propriétés » (tenant immobilier).
Ce lot corrige l'ensemble de la chaîne, sans se limiter au bug rapporté.

## Ce qui ne marchait pas

1. **Le catalogue ne reconnaissait pas le vocabulaire du secteur.** La
   détection de « présentez-moi le catalogue » reposait sur une liste figée
   (« produits », « catalogue »…) qui ne contenait ni « biens », ni
   « propriétés », ni aucun mot immobilier — le message tombait sur la
   recherche par nom, puis sur l'IA.
2. **Sans IA activée, plus aucune réponse déterministe.** Dès qu'un premier
   message échouait à trouver une correspondance ET que `ai_config.enabled`
   était à `false` (valeur par défaut à la création d'un tenant), la
   conversation passait en attente humaine — et y restait bloquée pour tous
   les messages suivants, y compris ceux que la FAQ ou le catalogue
   auraient pu couvrir.
3. **Prise en main = muette pour toujours.** Une fois qu'un commerçant
   répondait à la main, l'IA ne reprenait que sur un clic manuel
   (« Rendre à l'IA »), conversation par conversation — exactement le
   comportement que ce lot supprime.
4. **Clôturer une conversation la rendait sourde au client qui réécrit.**
5. **Messages avec pièce jointe seule (vocal, photo) perdus.** Ni
   enregistrés, ni notifiés, sur Zernio (WhatsApp/Messenger/Instagram)
   comme sur certains types Telegram (sticker, position, sondage…).
6. **Groupes WhatsApp connectés** : un message dans un groupe de diffusion
   pouvait déclencher une réponse automatique adressée à tout le groupe.
7. **Un envoi qui échoue** (canal déconnecté, fenêtre WhatsApp fermée)
   faisait juste échouer le webhook, sans prévenir personne.
8. Motifs d'escalade affichés bruts (`ai_unavailable`) dans le dashboard.
9. `returnConversationToAI`/`closeConversation` avalaient les erreurs de la
   base — l'admin voyait « succès » même en cas d'échec réel.
10. Libellé « Activer les réponses automatiques » trompeur : ne pilote que
    l'IA générative, pas la FAQ/le catalogue/les infos.

## Ce qui a changé

### Comportement (aucune action requise après déploiement)
- **L'IA est active par défaut dans toute conversation.** Une conversation
  clôturée se rouvre dès que le client réécrit ; après une réponse
  manuelle, l'IA reprend seule après un délai réglable (15 min par défaut,
  0 = jamais de pause) — `handoff-service.ts::applyAutoResume`, branché sur
  chaque message entrant (`conversation-service.ts`).
- **Vocabulaire de catalogue adapté au secteur** (`message-intents.ts`,
  `messaging-context-service.ts`) : un tenant immobilier reconnaît « vos
  biens », « vos propriétés », « présenté-moi » (fautes tolérées) ; un
  restaurant reconnaît « la carte », « vos plats » ; etc. Politesses
  (bonjour/merci/au revoir) reconnues et répondues sans jamais appeler
  l'IA ni chercher dans le catalogue.
- **Plus aucun message client sans réaction** (`inbound-auto-reply-service.ts`) :
  accusé de réception poli dans tous les cas où rien d'automatique ne peut
  répondre (IA indisponible, offre semi-automatique, plainte, pièce jointe
  seule, erreur technique), au plus une fois par 30 minutes, avec
  notification systématique de l'équipe. Un envoi qui échoue prévient
  aussi l'équipe au lieu d'échouer en silence.
- **Étapes déterministes résilientes** (`conversation-orchestrator.ts::safeStep`) :
  une FAQ ou une recherche catalogue en échec n'empêche plus les étapes
  suivantes.
- **Pièces jointes seules conservées**, sur Zernio et Telegram — voir les
  mappers concernés. Un message de groupe WhatsApp connecté ne crée plus
  ni conversation ni réponse automatique.
- **Motifs d'escalade en français** dans le dashboard
  (`domain/entities/handoff-reasons.ts`).
- **Reprise IMMÉDIATE de l'IA après un clic sur « Rendre à l'IA »
  entièrement fiable** : les erreurs Supabase remontent désormais
  correctement (`conversation-admin-service.ts`), au lieu d'être avalées.

### Interface
- `/dashboard/ai` : réglage de la pause IA après une réponse manuelle,
  et texte clarifiant que la case à cocher ne pilote que l'IA générative.
- `/dashboard/conversations/[id]` : bandeau d'état (IA active / en pause
  jusqu'à HH:mm / en attente d'un humain — motif / clôturée) et nouveau
  bouton « Prendre la main » pour mettre l'IA en pause sans écrire tout de
  suite un message.
- `/dashboard/conversations` : motif d'escalade affiché en français.

### Base de données
- **Migration à appliquer : `supabase/migrations/0068_ai_handoff_auto_resume.sql`**
  — ajoute `ai_config.human_pause_minutes` (défaut 15) et
  `conversations.human_takeover_at`. Idempotente, sans donnée à
  rétro-remplir. Le code fonctionne même si elle n'est pas encore
  appliquée (repli automatique sur le comportement précédent, best-effort
  partout où ces colonnes sont lues/écrites).

## Décision prise par défaut

Pause de l'IA après une réponse manuelle : **15 minutes**, réglable à tout
moment sur `/dashboard/ai` (0 = l'IA ne se met jamais en pause).

## Fichiers modifiés

```
supabase/migrations/0068_ai_handoff_auto_resume.sql          (nouveau)
docs/AI.md
docs/RAPPORT_LOT_P.md                                        (nouveau)

src/domain/entities/handoff-reasons.ts                       (nouveau)
src/domain/events/domain-events.ts

src/application/services/message-intents.ts                  (nouveau)
src/application/services/messaging-context-service.ts        (nouveau)
src/application/services/messaging-settings-service.ts       (nouveau)
src/application/services/conversation-orchestrator.ts
src/application/services/conversation-orchestrator.test.ts
src/application/services/handoff-service.ts
src/application/services/inbound-auto-reply-service.ts
src/application/services/conversation-service.ts
src/application/services/conversation-admin-service.ts
src/application/services/catalog-service.ts
src/application/services/service-catalog-service.ts
src/application/services/whatsapp-group-service.ts

src/infrastructure/providers/messaging/zernio/mapper.ts
src/infrastructure/providers/messaging/zernio/mapper.test.ts
src/infrastructure/providers/messaging/telegram/mapper.ts

src/app/api/webhooks/zernio/route.ts
src/app/api/webhooks/telegram/tenant/[token]/route.ts
src/app/dashboard/ai/page.tsx
src/app/dashboard/conversations/page.tsx
src/app/dashboard/conversations/[id]/page.tsx
src/app/dashboard/conversations/[id]/conversation-thread-view.tsx
```

## Comment j'ai vérifié (et limites)

Aucun accès npm/réseau dans mon environnement : ni `npm install`, ni
`vitest`, ni un `tsc` complet avec les vraies dépendances. Deux méthodes
de substitution :

1. **Typecheck comparatif.** `tsc --noEmit` tourne quand même (sans
   `node_modules`, il produit un bruit de fond massif — modules externes
   introuvables, JSX sans types React — sur TOUT le projet, y compris les
   fichiers non touchés). J'ai comparé le nombre d'erreurs de chaque
   fichier modifié AVANT/APRÈS, filtré ce bruit connu, et confirmé
   qu'aucune erreur de type réelle n'a été introduite — une seule
   régression trouvée (un mauvais chemin d'import) a été corrigée.
2. **Relecture ligne à ligle des tests existants.** `inbound-auto-reply-service.test.ts`,
   `handoff-service.test.ts` et `mapper.test.ts` existaient déjà et
   n'ont pas tous été réécrits : j'ai rejoué à la main chaque scénario
   contre le nouveau code (entrées → sorties attendues) pour confirmer
   qu'ils passent toujours. `conversation-orchestrator.test.ts` a été
   étendu avec nos nouveaux cas (politesses, vocabulaire immobilier,
   résilience) et un mock ajouté pour le nouveau service de contexte
   tenant.

**Ce qu'il reste à faire chez vous avant mise en production :**
- `npm install && npx vitest run` pour confirmer avec les vraies
  dépendances (React, Supabase, etc.) — je n'ai pu que raisonner dessus,
  pas exécuter.
- Appliquer la migration `0068`.
- Un test WhatsApp réel comme celui qui a déclenché cet audit, en
  particulier : premier message d'une nouvelle conversation, puis une
  demande de catalogue dans votre vocabulaire métier.
