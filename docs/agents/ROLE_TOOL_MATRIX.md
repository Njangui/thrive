# Matrice rôle × outil (maintenue par C1)

Source de vérité : le code (`createAgentKernel().registerTool(tool, { roles })`). Ce fichier documente les règles et la section générée ci-dessous (`renderRoleToolMatrix`). Tout outil d'un autre périmètre ajoute **sa ligne** dans la PR qui l'enregistre.

## Règles (moteur `src/application/agents/rule-engine.ts`)
1. **Fail-closed** : permission non déclarée => refus, même pour `owner`.
2. **Rôle OU extra** : la permission est accordée si le rôle figure dans la matrice, ou si `memberships.extra_permissions` contient la clé de la permission à `true` (ex. `{"catalog.price": true}`).
3. **Outils activés par tenant** (`agent_settings.enabled_tools`) : sans réglage, seuls les outils `read` sont utilisables. L'agent n'a jamais plus de droits que ce que le propriétaire a activé.
4. **Risque** : `read` libre ; `write_reversible` = confirmation par défaut (le propriétaire peut passer à `allow`) ; `sensitive` = **toujours** confirmé + step-up (C2) à l'approbation.
5. **Vitrine (canal `customer`)** : uniquement les outils `storefrontSafe` (lecture ou brouillon inerte) ; jamais `sensitive`. La permission de rôle n'est pas évaluée pour ce canal.
6. **Plafond de budget** (`agent_settings.budget.max_units_per_action`) : dépassement => confirmation.

## Grille de départ conseillée (à valider par le propriétaire produit)
| Famille de permission | owner | admin | manager | sales | cashier | employee | accountant |
|---|---|---|---|---|---|---|---|
| `*.read` (lecture de son domaine) | ✓ | ✓ | ✓ | selon domaine | selon domaine | selon domaine | finance/ventes |
| écriture réversible | ✓ | ✓ | ✓ | son domaine | caisse | tâches/notes | — |
| sensible (prix, remboursement, diffusion, suppression, dépense, publication) | ✓ | ✓ | à justifier | — | — | — | à justifier (finance) |

Une PR qui ouvre un outil `sensitive` à un rôle autre que `owner`/`admin` doit le justifier dans sa description.

## Outils enregistrés
<!-- Section générée : `renderRoleToolMatrix(registry.list(), matrix)`. Aucun outil n'est enregistré à ce stade (P1) : les périmètres C2 à C5 branchent les leurs en vague 2. -->

| Outil | Domaine | Risque | Permission | Vitrine | owner | admin | manager | sales | cashier | employee | accountant |
|---|---|---|---|---|---|---|---|---|---|---|---|

## Outils mémoire (C1, P6) — branchés via `createMemoryRegistrar(service)`
| Outil | Risque | Permission | Rôles | Vitrine |
|---|---|---|---|---|
| `memory.search` | read | `memory.read` | owner, admin, manager | non |
| `memory.remember` | write_reversible | `memory.write` | owner, admin, manager | non |
| `memory.forget` | write_reversible | `memory.forget` | owner, admin, manager | non |

Justification : la lecture directe de `tenant_memory` (RLS) est limitée aux mêmes rôles ; préférences et décisions peuvent être sensibles. L'effacement définitif n'est PAS un outil d'agent (service `erase`, tableau de bord, owner/admin).

## Étape 2 — Catalogue, prospects, conversations (`domains/commerce.ts`)

Rôles : owner / admin / manager (employee : aucun outil). Les clients (zone vitrine) n'ont accès à aucun de ces outils.

| Outil | Risque | Notes |
|---|---|---|
| `products.create` | écriture | toujours en BROUILLON |
| `products.update` | écriture | nom/description/catégorie ; prix et promo conservés |
| `products.setStatus` | écriture | publier / retirer ; aperçu avant/après |
| `categories.list` / `categories.create` | lecture / écriture | |
| `leads.list` | lecture | téléphones masqués, notes tronquées (donnée, pas instruction) |
| `leads.setStatus`, `contacts.setNotes` | écriture | |
| `conversations.list` / `conversations.get` | lecture | contenu client tronqué, téléphone masqué |
| `conversations.takeOver` / `returnToAi` / `close` | écriture | n'envoient aucun message |
| `conversations.reply` | écriture, **`confirmAlways`** | validation toujours demandée (garde-fou fixe), texte exact montré |

## Étape 3 — Marketing (`domains/marketing.ts`)

| Outil | Rôles | Risque | Notes |
|---|---|---|---|
| `broadcasts.previewAudience`, `broadcasts.list` | owner/admin/manager | lecture | |
| `broadcasts.create` | owner/admin/manager | écriture, **`confirmAlways`** | carte : texte, nombre de destinataires, canaux |
| `broadcasts.cancel` | owner/admin/manager | écriture | avant départ seulement |
| `publications.targets`, `publications.recent` | owner/admin/manager | lecture | objets bruts des canaux jamais exposés |
| `publications.publish` | owner/admin/manager | écriture, **`confirmAlways`** | canaux résolus côté serveur depuis leurs identifiants |
| `comments.list` | owner/admin | lecture | texte public tronqué (donnée) |
| `comments.reply` | owner/admin | écriture, **`confirmAlways`** | réponse publique |
| `comments.hide` / `comments.unhide` | owner/admin | écriture | réversible |

## Étape 4 — Administration (`domains/admin.ts`)

| Outil | Rôles | Risque | Notes |
|---|---|---|---|
| `team.list` | owner/admin | lecture | emails masqués |
| `team.invite`, `team.setRole`, `team.remove` | owner/admin | **sensible** (validation + PIN) | rôle « owner » non attribuable ; jamais sur soi-même ; jeton d'invitation jamais renvoyé |
| `team.revokeInvitation` | owner/admin | écriture | |
| `faq.list` | owner/admin/manager | lecture | |
| `faq.create`, `faq.update` | owner/admin/manager | écriture, **`confirmAlways`** | visible des clients |
| `faq.setActive` | owner/admin/manager | écriture | |
| `faq.delete` | owner/admin/manager | **sensible** | |
| `business.get` | owner/admin | lecture | |
| `business.update` | owner/admin | écriture, **`confirmAlways`** | fusion avec l'existant, aperçu avant → après |
| `alerts.get` / `alerts.update` | owner/admin | lecture / écriture | fusion avec l'existant |
| `subscription.status`, `credits.status` | owner/admin | lecture seule | aucun outil de changement d'offre ou de paiement |

## Étape 5 — Tâches planifiées (`domains/tasks.ts`)

| Outil | Rôles | Risque | Notes |
|---|---|---|---|
| `tasks.list` | owner/admin | lecture | |
| `tasks.create` | owner/admin | écriture, **`confirmAlways`** | max 10 actives, répétition ≥ 1 h, consigne ≤ 1000 car., heure de Douala |
| `tasks.pause` / `tasks.resume` / `tasks.delete` | owner/admin | écriture | reprise sans rattrapage |

Une tâche s'exécute avec les droits de son créateur (canal `scheduler`), sous la politique de validation de l'entreprise. Une tâche en cours ne peut pas gérer les tâches. Le résultat est livré dans le fil « Tâches planifiées » du chat (texte + cartes de validation) ; une notification est envoyée quand une validation est attendue.

## Étape 7 — Site libre (`domains/site.ts`)

| Outil | Rôles | Risque | Notes |
|---|---|---|---|
| `site.blockGuide`, `site.overview`, `site.getPage`, `site.listImages`, `site.history`, `site.lint` | owner/admin/manager | lecture | un employé n'a aucun outil de gestion |
| `site.edit` | owner/admin/manager | écriture (brouillon) | ≤ 30 opérations atomiques, schéma strict ; une étape d'historique par appel ; jamais public |
| `site.revert` | owner/admin/manager | écriture (brouillon) | le retour est lui-même une étape |
| `site.discardDraft` | owner/admin/manager | écriture, **`confirmAlways`** | supprime le brouillon et son historique fin ; site public inchangé |
| `site.restoreVersion` | owner/admin | écriture, **`confirmAlways`** | recrée un brouillon depuis une ancienne version ; ne publie pas |
| `site.publish` | owner/admin | **sensible** (validation + PIN) | bloqué par le contrôle SEO critique ; ancienne version archivée, restaurable |

Limite connue : la permission supplémentaire `publish_site` (gérant autorisé à publier) est respectée dans l'éditeur du tableau de bord mais pas par l'assistant, dont la matrice n'accorde `site.publish` qu'à owner/admin (choix prudent).

## Étape 8 — Prospection WhatsApp (`domains/prospecting.ts`, tenant Flexco uniquement)

| Outil | Rôles | Risque | Notes |
|---|---|---|---|
| `prospecting.guide`, `prospecting.templates`, `prospecting.list`, `prospecting.preview` | owner/admin | lecture | refusé pour toute entreprise autre que Flexco (`FLEXCO_PLATFORM_ORG_ID`) |
| `prospecting.createCampaign` | owner/admin | écriture (brouillon) | import CSV ; aucun envoi ; numéros invalides/doublons/désinscrits écartés |
| `prospecting.pause` | owner/admin | écriture | effet immédiat |
| `prospecting.submitTemplates` | owner/admin | écriture, **`confirmAlways`** | textes fixes envoyés à Meta, aucune donnée de prospect |
| `prospecting.resume`, `prospecting.cancel` | owner/admin | écriture, **`confirmAlways`** | la reprise exige que la validation reste valable |
| `prospecting.approve` | owner/admin | **sensible** (validation + PIN) | liée à l'empreinte (messages + liste + règles) ; base de contact obligatoire |

L'envoi n'est PAS un outil : il est fait par `/api/cron/process-prospecting`.
