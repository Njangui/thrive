# SME-OS — modèle tarifaire v2

## Grille

| Plan | Prix mensuel | Groupes WhatsApp | Diffusion | Crédits IA | Réseaux sociaux |
|---|---:|---:|---:|---:|---:|
| Starter | 9 900 FCFA | 2 (+1 numéro dédié) | 50 | 150 | 1 |
| Business | 19 900 FCFA | 5 (+3 numéro dédié) | 100 | 500 | 3 |
| Pro | 39 900 FCFA | 10 (+5 numéro dédié) | 200 | 1 500 | 6 |

Business est positionné comme palier central : son prix double approximativement
le Starter mais augmente fortement les ressources variables et débloque Facebook
Messenger + Instagram. Pro augmente encore la capacité pour les entreprises et
équipes à plus gros volume et débloque LinkedIn + TikTok.

## Pourquoi les quotas portent sur ces fonctions

Les ressources susceptibles d'augmenter directement la facture de la plateforme
sont principalement les connexions de canaux, les messages/diffusions et les
appels IA. Elles sont donc plafonnées explicitement dans `plan_entitlements`.
Les fonctions métier fondamentales (dashboard, catalogue, vitrine, CRM, FAQ,
finance légère et les modules adaptés au secteur) restent au cœur de l'offre.

## Discipline financière

Les montants ci-dessus sont des **prix commerciaux recommandés**, pas une
reconstruction de factures fournisseur. En production, suivre au minimum :

- coût moyen d'infrastructure par organisation active ;
- coût moyen des comptes/connecteurs Zernio ;
- coût moyen IA par organisation ;
- coût email/stockage ;
- commissions de paiement ;
- commissions d'affiliation ;
- support humain.

La marge brute réelle doit être recalculée mensuellement. Le Super Admin peut
ensuite ajuster prix et quotas depuis `/admin/plans` sans modifier le code.
