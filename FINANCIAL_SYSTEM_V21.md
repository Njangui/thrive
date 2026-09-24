# CRESYVA — Système financier V21

## 1. Plateforme CRESYVA

Le cockpit `/admin/finance` sépare désormais :

- **CA brut** : paiements SaaS confirmés + paiements remboursés historiques.
- **Remboursements** : paiements actuellement marqués `refunded`.
- **CA net** : CA brut - remboursements.
- **Coût de revient** : coûts directement nécessaires à la livraison du SaaS, classés `cost_of_revenue`.
- **Bénéfice brut** : CA net - coût de revient.
- **Marge brute** : bénéfice brut / CA net.
- **Charges d'exploitation** : marketing, salaires, comptabilité, juridique, etc.
- **Résultat d'exploitation** : bénéfice brut - charges d'exploitation.
- **Impôts / taxes** : charges classées `tax`.
- **Bénéfice net** : résultat d'exploitation - impôts/taxes.
- **Marge nette** : bénéfice net / CA net.

Les remboursements sont séparés pour éviter de présenter un paiement remboursé comme du revenu définitivement acquis.

## 2. Coûts de plateforme

Le référentiel `platform_costs` permet de documenter les postes récurrents ou prévisionnels sans les confondre avec les dépenses réellement payées :

- hébergement / déploiement
- PostgreSQL / base de données
- stockage
- e-mail transactionnel
- IA
- frais de paiement
- domaines
- téléphonie / numéros
- marketing
- affiliation
- salaires
- juridique
- comptabilité
- monitoring / cron / observabilité
- autres

Aucun tarif externe n'est inventé : les lignes initiales sont des checklists avec budget vide. Le Super Admin renseigne les montants réels.

Les dépenses effectivement payées restent dans `platform_expenses` et seules celles-ci entrent dans le résultat réalisé.

## 3. Zernio

Le coût Zernio est calculé automatiquement à partir des comptes connectés, avec les paliers officiels actuellement publiés : 2 comptes gratuits, puis 6 USD pour les comptes 3–10, 3 USD pour les comptes 11–100 et 1 USD pour les comptes 101–2 000. Au-delà de 2 000, Zernio indique une tarification custom.

Les frais variables spécifiques (numéros, X/Twitter, publicité, etc.) restent séparés et doivent être enregistrés lorsqu'ils apparaissent sur la facture.

## 4. Finance tenant

`/dashboard/finance` calcule désormais :

- revenus reconnus
- encaissements réels
- coût des marchandises / prestations vendues (COGS)
- bénéfice brut
- marge brute
- charges d'exploitation
- résultat d'exploitation
- impôts/taxes
- bénéfice net
- marge nette
- créances ouvertes
- créances en retard
- tendance 30 jours
- historique 12 mois
- répartition des dépenses
- performance des produits vendus

### COGS historique

`order_items.unit_cost` est maintenant figé au moment de la création d'une commande à partir de `products.cost_price`. Une modification ultérieure du prix d'achat du catalogue ne réécrit donc pas l'ancienne marge.

Les dépenses tenant peuvent être classées :

- `cost_of_revenue` — coût direct / achat revendu
- `operating` — charge d'exploitation
- `tax` — impôt / taxe

## 5. Encaissement ≠ revenu

Le cockpit distingue volontairement :

- **revenu reconnu** : ce qui est comptabilisé comme vente/revenu ;
- **cash encaissé** : paiements clients réellement `succeeded` dans la table `payments`.

Cette distinction évite de confondre rentabilité et trésorerie.

## 6. Limites volontairement conservées

- Les tarifs externes ne sont pas inventés et doivent être saisis/configurés lorsqu'ils ne sont pas automatiquement calculables.
- Les données historiques dont CRESYVA ne possède pas le coût unitaire réel sont traitées avec le coût disponible en base ; les nouvelles commandes disposent d'un snapshot de coût.
- Le build Next complet doit être exécuté dans un environnement disposant des dépendances (`node_modules`) et des variables Supabase réelles.
