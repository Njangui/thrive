# C2 — Identités de canal et authentification renforcée (étape 1)

Branche `agents/c2-canaux` · migration `0120_channel_identities_step_up.sql` · plage C2 : 0120-0139.

## Ce qui est livré
| Brique | Fichier |
|---|---|
| Tables + RLS + fonctions atomiques | `supabase/migrations/0120_channel_identities_step_up.sql` |
| Type d'acteur back-office, adaptateur `extra_permissions` | `src/application/channels/actor.ts` |
| Codes de liaison, normalisation Telegram / E.164 | `src/application/channels/channel-codes.ts` |
| Empreinte d'action (JSON canonique + sha256) | `src/application/channels/action-fingerprint.ts` |
| Politique de PIN | `src/application/channels/pin-policy.ts` |
| Hachage scrypt (+ poivre optionnel) | `src/infrastructure/security/pin-hasher.ts` |
| Port `StepUpPort` | `src/domain/ports/step-up-port.ts` |
| Adaptateur Supabase | `src/infrastructure/channels/supabase-step-up-adapter.ts` |
| Liaison, révocation, `resolveActor` | `src/application/services/channel-identity-service.ts` |

## Décisions (jugements documentés)
1. **Telegram back-office = bot plateforme** (`TELEGRAM_BOT_TOKEN`), pas les bots tenant. Les bots tenant restent le canal *client* : séparer les deux garde les zones de confiance étanches (principe 6). Le routage `/start` du webhook plateforme (affilié vs membre) est fait à l'étape 3.
2. **Identifiant Telegram = id numérique**, jamais le `@username` (modifiable, réattribuable).
3. **Une identité active par membre et par canal** ; re-lier remplace l'ancienne (révocation `replaced`, auditée). Une identité déjà active pour *un autre membre du même tenant* bloque la liaison (`IDENTITY_ALREADY_LINKED`) : pas de vol silencieux d'identité.
4. **Multi-tenant** : une même identité Telegram peut être liée à plusieurs tenants (consultant). `resolveActor` renvoie alors `ambiguous` ; la commande `/org` qui lève l'ambiguïté vient à l'étape 3.
5. **Rôle et permissions relus à chaque message** (aucun cache) : un changement de rôle ou une révocation est immédiat.
6. **Tenant `suspended` / `cancelled` ⇒ aucun pilotage par chat** (`tenant_inactive`). `past_due` reste autorisé (la facturation est traitée ailleurs).
7. **`extra_permissions`** : le jsonb objet actuel est conservé ; seules les clés valant strictement `true` deviennent des permissions (`string[]` du contrat C1). Aucune migration destructive.
8. **PIN** : 6 à 8 chiffres, motifs triviaux refusés. scrypt (N=2^15) + sel aléatoire + **poivre serveur** `STEP_UP_PIN_PEPPER` (≥ 16 car., recommandé en production : sans lui, une fuite de base rend les 10^6 PIN énumérables hors ligne). 5 échecs ⇒ verrou 5 min, doublé à chaque palier (plafond 24 h). Compteur sous verrou de ligne SQL (pas de contournement par requêtes parallèles).
9. **Défi lié à l'empreinte exacte** de l'action, usage unique (`UPDATE … where status='approved'`), durée 60-900 s (300 par défaut). Le moteur de règles de C1 choisit `allowedMethods` : un remboursement n'accepte **pas** le bouton Telegram seul.
10. **Audit atomique** : création/révocation d'identité auditées *dans la transaction SQL*. Les événements StepUp (PIN défini/changé/réinitialisé, approuvé, refusé, consommé) sont écrits dans `audit_logs` ; une défaillance d'audit est loguée sans bloquer l'authentification.
11. **Secrets** : ni code de liaison, ni jeton de lien, ni PIN n'est stocké en clair (sha256 / scrypt) ; aucun n'apparaît dans les logs ni dans `audit_logs`.

## Modèle de menace (extrait, à compléter aux étapes 3 et 5)
| Menace | Parade |
|---|---|
| Code de liaison deviné | 50 bits, 10 min, usage unique, 5 générations/h ; **à ajouter à l'étape 3** : limitation de débit par expéditeur sur `/start` (`rate-limit.ts`) |
| Code intercepté | haché en base, supprimé à la génération suivante ; lien lié au membre connecté |
| Vol de téléphone / échange de SIM | actions sensibles ⇒ PIN (ou lien dashboard) ; verrouillage progressif |
| Fuite de la base | PIN scrypt + poivre hors base ; hachages non lisibles par RLS |
| Rejeu d'une approbation | usage unique + empreinte exacte + expiration |
| Défi d'un collègue / d'un autre tenant | présenté comme « introuvable » ; filtres `membership_id` + `organization_id` partout |
| Employé qui tente une action supérieure | `resolveActor` fournit le rôle réel ; le refus d'outil hors rôle relève du moteur de règles C1 (test E2E à l'étape 2/3) |
| Révocation tardive | rôle/identité relus à chaque message |

## Limites connues / à faire
- `Actor`, `computeActionFingerprint` : **miroirs locaux** de l'esquisse C1 (`contracts.ts`) ; à remplacer par les exports de C1 à la fusion de sa PR « contrats ».
- Pas encore de limitation de débit sur la consommation de code (étape 3) ; pas de purge des défis/codes expirés (tâche planifiée C1, ou cron dédié).
- Identités WhatsApp : le statut `pending` existe mais la vérification par code envoyé au numéro est à l'étape 5.
- RLS : testée statiquement (`tests/rls-policies.test.ts`, deux tables ajoutées à l'allowlist service-role-only avec justification). **Un test d'intégration contre un vrai Postgres est à faire** (non exécutable ici) : les fonctions SQL sont validées syntaxiquement (pglast) et émulées dans les tests unitaires, pas exécutées.

## Tester
```
npx vitest run src/application/channels src/infrastructure/channels src/infrastructure/security \
  src/application/services/channel-identity-service.test.ts tests/rls-policies.test.ts
```
`tests/helpers/fake-supabase.ts` : faux client en mémoire (réutilisable aux étapes suivantes).
Avant déploiement : appliquer 0120 sur un Supabase de préproduction et rejouer les scénarios liaison → résolution → révocation.
