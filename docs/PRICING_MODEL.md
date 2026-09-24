# tokoo  — modèle tarifaire (freemium)

> Mis à jour à la fusion #16 : la grille « v2 » précédente (Starter 9 900 / Business
> 19 900 / Pro 39 900 FCFA, avec période d'essai) est **remplacée**. Source de vérité
> des valeurs ci-dessous : `supabase/migrations/0061_freemium_plan.sql` (grille
> commerciale transmise pour ce lot) ; le Super Admin peut ensuite les ajuster depuis
> `/admin/plans` sans modifier le code.

## Principe : une offre gratuite permanente, plus d'essai

Une entreprise démarre sur le plan **`free`** (affiché « Discover »), **sans limite de
durée et sans carte bancaire**. Elle passe à une offre payante quand elle en a besoin
(paiement via NotchPay) et peut **repasser à l'offre gratuite à tout moment** depuis
« Mon abonnement » (`switchToFreePlan`, aucun paiement à traiter).

- Il n'y a plus de période d'essai : `organization_subscriptions.trial_end` reste en base
  pour l'historique mais n'est plus jamais renseigné. Le statut `trialing` n'existe plus
  que comme état hérité (l'admin l'affiche « Essai (hérité) »).
- L'offre gratuite n'a **aucune échéance** : le cron `process-subscription-renewals`
  ne la charge même pas.
- Quand un abonnement **payant** arrive à échéance sans paiement, il passe `past_due` et
  l'entreprise est notifiée (renouveler ou repasser à l'offre gratuite). Le cron se
  contente de ce changement de statut et de la notification : aucune rétrogradation
  automatique n'y est faite.
- Le palier « Business » est retiré du modèle actif (un 4ᵉ palier viendra plus tard) ;
  `0061` ramène toute organisation restée dessus à `starter`.

## Grille (valeurs semées par `0061`)

| Plan | Prix mensuel | WhatsApp | Groupes WhatsApp (+ bonus numéro dédié) | Contacts par diffusion | Crédits IA / mois | Comptes réseaux sociaux | Messenger | Instagram | LinkedIn | TikTok |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Discover (`free`) | 0 FCFA | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Starter | 15 000 FCFA | 1 | 3 (+2) | 50 | 150 | 1 | 1 | 0 | 0 | 0 |
| Pro | 30 000 FCFA | 1 | 6 (+4) | 100 | 300 | 3 | 1 | 1 | 1 | 1 |

Discover est le **socle** : site public, catalogue, messagerie unifiée sans IA, finance
légère, CRM léger. Starter et Pro ajoutent les canaux (WhatsApp, réseaux sociaux), les
groupes et l'assistant IA. Le « bonus numéro dédié » s'ajoute aux groupes de base quand
l'entreprise dispose d'un numéro WhatsApp dédié aux groupes (connecté par elle ou loué à
la plateforme — voir `docs/DEPLOYMENT.md`, section 4quater).

### Prix par pays

Seuls les plans **payants** ont un prix par pays (`plan_prices`). Le plan gratuit reste à
0 partout : il n'a jamais de ligne et n'entre pas dans la checklist d'activation d'un
pays (voir `docs/country-engine.md`).

### Limites non appliquées dans le code

L'en-tête de `0061` le précise : plusieurs dimensions de la grille transmise (canaux/bots
Telegram, comptes YouTube multiples, comptes WhatsApp multiples, taille d'équipe, quota de
catalogue, réponse automatique aux commentaires, commentaires unifiés) n'ont **pas** de
clé d'entitlement ni d'application dans le code. Constat de la fusion #16 : les
nouveautés « vidéos de catalogue », « analytique vitrine » et « pièces jointes » ne
contiennent pas non plus de contrôle de plan. Ces fonctions sont donc ouvertes à toutes
les offres, Discover comprise, tant qu'un lot dédié ne les plafonne pas.

## Pourquoi les quotas portent sur ces fonctions

Les ressources susceptibles d'augmenter directement la facture de la plateforme
sont principalement les connexions de canaux, les messages/diffusions et les
appels IA. Elles sont donc plafonnées explicitement dans `plan_entitlements`.
Les fonctions métier fondamentales (dashboard, catalogue, vitrine, CRM, FAQ,
finance légère et les modules adaptés au secteur) restent au cœur de l'offre.

## Discipline financière

Les montants ci-dessus sont des **prix commerciaux recommandés**, pas une
reconstruction de factures fournisseur. En production, suivre au minimum :

- coût moyen d'infrastructure par organisation active — **y compris les
  organisations gratuites**, qui sont désormais la majorité : l'offre gratuite a
  un coût réel (stockage, hébergement de vidéos, messagerie) sans revenu associé ;
- coût moyen des comptes/connecteurs Zernio ;
- coût moyen IA par organisation ;
- coût email/stockage ;
- commissions de paiement ;
- commissions d'affiliation ;
- support humain.

La marge brute réelle doit être recalculée mensuellement. Le Super Admin peut
ensuite ajuster prix et quotas depuis `/admin/plans` sans modifier le code.
