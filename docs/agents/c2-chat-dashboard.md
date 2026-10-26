# C2 — Chat propriétaire du dashboard (étape 2)

Migration `0121_assistant_chat.sql` · page `/dashboard/assistant` · API `/api/dashboard/assistant/*`.

## Livré
| Brique | Fichier |
|---|---|
| Tables `assistant_threads`, `assistant_messages` (+ RLS, index, trigger de cohérence) | `supabase/migrations/0121_assistant_chat.sql` |
| Port runtime (frontière C1) + adaptateur « indisponible » | `src/domain/ports/agent-runtime-port.ts`, `src/infrastructure/agents/runtime-registry.ts` |
| Acteur d'une session dashboard | `src/application/channels/dashboard-actor.ts` |
| Fils, historique, tour streamé, décisions d'approbation | `src/application/services/assistant-chat-service.ts` |
| Pièces jointes (liste blanche + signature binaire) | `src/application/services/assistant-attachment-service.ts` |
| Routes `stream` (NDJSON), `upload`, `approvals`, `threads`, `threads/[id]` | `src/app/api/dashboard/assistant/` |
| UI mobile d'abord | `src/app/dashboard/assistant/` + entrée de navigation |
| Limiteurs de débit `assistant` (20/min) et `assistant_upload` (10/min), par utilisateur | `src/lib/rate-limit.ts` |

## Décisions
1. **Branchement C1** : C1 appelle `registerAgentRuntime(...)` au démarrage serveur. Tant qu'il ne l'a pas fait, le chat affiche « assistant non activé » (aucune réponse inventée). `Actor`/types sont des miroirs locaux de `contracts.ts`.
2. **Confidentialité des fils** : un membre ne lit que ses propres fils, **owner compris**. Les actions restent tracées dans l'audit de C1.
3. **Approbations** : l'état réel vit dans `pending_actions` (C1) ; le fil ne garde que la carte et son état d'affichage. Une carte ne se décide qu'une fois. Si la carte exige un step-up, le PIN (ou le lien dashboard) est vérifié par `StepUpPort` AVANT l'appel au runtime, et seules les méthodes autorisées par le moteur de règles sont acceptées. « Modifier » n'accepte que les champs déclarés éditables et produit une NOUVELLE carte (nouvelle empreinte) : rien n'est exécuté sur une modification.
4. **Idempotence mobile** : `clientMessageId` (index unique) ; un renvoi ne relance pas le modèle.
5. **Coupure réseau** : le texte partiel est conservé (statut `aborted`).
6. **Données non fiables** : tout est rendu en texte brut ; aucun HTML interprété.
7. **Erreurs** : détail dans les logs serveur, message générique au client.
8. **Chemins de pièces jointes** : le client ne peut référencer que `{tenantId}/assistant-attachment/{uuid}-nom` (un bug d'isolation inter-tenants de ma première version a été corrigé avant livraison, avec tests).

## Limites / à faire
- **Stockage public** : les pièces jointes passent par le bucket public `tenant-media` (chemin non devinable, mais URL non authentifiée). À migrer vers un stockage privé à URL signées (adaptateur R2 de C4). **Point à valider** avant de laisser des reçus ou des données clients transiter.
- **Vocaux** : le fichier audio est transmis au runtime ; la transcription dépend du `SpeechPort` de C3 (étape finale).
- **Rafraîchissement** : après un tour, le fil est rechargé pour obtenir les ids réels des messages (nécessaires aux approbations) ; une connexion coupée en plein flux laisse la carte non cliquable jusqu'au rechargement.
- Nouveau `MediaType` `assistant-attachment` dans `media-service.ts` (union de types, changement minimal hors périmètre, à signaler à C4).
- Pas de test E2E navigateur ni d'exécution SQL réelle (même réserve que 0120). Le champ « PIN oublié / non défini » renvoie vers Équipe > Sécurité, **écran non encore construit**.
- Avertissement eslint `<img>` conservé : `next/image` exigerait de configurer le domaine de stockage.

## Tester
```
npx vitest run src/application/services/assistant-chat-service.test.ts src/application/services/assistant-attachment-service.test.ts tests/rls-policies.test.ts
```
