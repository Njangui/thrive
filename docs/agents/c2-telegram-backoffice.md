# C2 — Bot Telegram de back-office (étape 3)

Migration `0122_telegram_backoffice.sql` · service `telegram-backoffice-service.ts` · écrans `/dashboard/security` et `/dashboard/approve/[token]`.

## Fonctionnement
- **Bot** : le bot plateforme existant (`TELEGRAM_BOT_TOKEN`). Le webhook passe d'abord chaque message au back-office ; s'il ne le reconnaît pas (jeton affilié, `/mystats`, groupe…), le flux affilié actuel le traite à l'identique. Les bots tenant (canal client) ne sont pas touchés.
- **Liaison** : Dashboard > Sécurité > « Générer un code » → `/start CODE` en conversation privée. Le message contenant le code est supprimé du chat. Code : 10 car., 10 min, usage unique, 5/h ; 5 essais/min par id Telegram.
- **Conversation** : identité → acteur (rôle relu à chaque message) → même service de chat que le dashboard (fil « Telegram » par membre, historique, limites de débit, traçabilité).
- **Commandes** : `/aide`, `/org` (plusieurs entreprises, choix mémorisé), `/deconnecter` (révocation, auditée).
- **Approbations** : carte avec boutons Valider / Refuser. Le moteur de règles (C1) choisit la méthode :
  | Méthode autorisée | Parcours |
  |---|---|
  | `telegram_button` (faible risque) | un clic suffit |
  | `pin` | clic « Valider » → saisie du PIN dans le chat, **message supprimé immédiatement**, attente 5 min |
  | `dashboard_link` | bouton URL → page de confirmation (clic explicite, session du membre) → retour au chat, « Valider » |
  « Modifier » n'existe pas dans Telegram (renvoi vers le dashboard).

## Sécurité (modèle de menace — mise à jour)
| Menace | Parade |
|---|---|
| Back-office dans un groupe | refus si `chat.type ≠ private` ou `chat.id ≠ from.id` ; un code posté en groupe est supprimé et **jamais consommé** |
| Bouton d'approbation transféré / cliqué par un autre | la carte est liée au membre ET au chat ; autre membre, carte inconnue ou groupe → même réponse « non autorisée » (aucune fuite d'existence) |
| Membre délié entre-temps | `resolveActor` à chaque clic : le bouton cesse de fonctionner |
| Bouton Telegram pour une action sensible | accepté seulement si `telegram_button` est autorisé par le moteur de règles ET si l'acteur vient de Telegram |
| PIN lisible dans l'historique | message supprimé (best-effort) ; jamais stocké ni journalisé ; test dédié |
| Chiffres pris pour un PIN | uniquement avec une carte « en attente de PIN » non expirée du même membre et du même chat |
| Injection par message client cité | texte brut (pas de `parse_mode`) ; le contenu reste une donnée pour le runtime |
| Rejeu du webhook | secret + déduplication `update_id` (existants) |
| Flood | 40 mises à jour/min par id Telegram avant tout accès base |
| GET sur le lien de validation | aucun effet (aperçus de liens) ; clic explicite en Server Action |

## Limites / à vérifier
- **Suppression du PIN** : `deleteMessage` peut échouer (message trop ancien, droits). Le PIN reste alors dans le chat ; l'échec est journalisé (sans le PIN). À vérifier en conditions réelles.
- Telegram ne gère que le **texte** : photos et vocaux restent sur le dashboard (vocaux : étape finale avec le `SpeechPort` de C3).
- Un tour d'agent s'exécute **dans la requête du webhook** (`maxDuration = 60`). Si les tours dépassent ce délai, Telegram retentera ; la déduplication évite le double traitement mais la réponse pourrait manquer → passer à une file de traitement (C1 : tâches planifiées).
- Réinitialiser son PIN depuis une session dashboard : un voleur de session peut le faire. Le PIN protège contre un Telegram/SIM compromis, pas contre un compte dashboard compromis (décision à confirmer).
- Pas de purge des cartes/codes expirés (tâche planifiée C1). Aucun test E2E avec l'API Telegram réelle ni exécution SQL réelle.
- Fichiers hors périmètre modifiés (changements minimaux) : `webhooks/telegram/route.ts`, `telegram/client.ts` (+`deleteMessage`, `editMessageText`), `rate-limit.ts`, `dashboard-nav.tsx`.

## Tester
```
npx vitest run src/application/services/telegram-backoffice-service.test.ts src/app/api/webhooks/telegram tests/rls-policies.test.ts
```
Avant déploiement : appliquer 0121 et 0122 en préproduction, créer un bot de test, rejouer liaison → message → carte → PIN → révocation.
