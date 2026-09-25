# flexco  — Finance audit & polish V22 — 2026-09-22

## Corrections effectuées

1. **Pricing Zernio corrigé**
   - 1–2 comptes : gratuit
   - 3–10 : 6 USD/compte/mois
   - 11–100 : 3 USD/compte/mois
   - 101+ : 1 USD/compte/mois, y compris au-delà de 2 000 dans le barème self-service actuel.
   - Le cockpit présente cette valeur comme un rythme mensuel estimé à partir du nombre actuel de comptes. La facturation réelle de Zernio prorate les changements par jour.

2. **Comptage Zernio corrigé**
   - `social_accounts` connectés + `whatsapp_accounts` connectés.
   - Les profils Zernio ne sont pas comptés.
   - Le provider de groupes WhatsApp n'est pas compté comme un compte Zernio supplémentaire.
   - YouTube n'est pas compté : dans flexco  il est connecté directement via Google.

3. **Série quotidienne corrigée**
   - Les remboursements sont soustraits de la courbe de revenus quotidienne.
   - La courbe n'est plus alimentée uniquement par les paiements `completed`.

4. **Compatibilité des catégories de dépenses**
   - La migration 0068 avait un CHECK historique limité à `infrastructure`, `ai`, `payment`, `marketing`, etc.
   - Le cockpit V21 utilise un référentiel plus fin (`hosting`, `database`, `storage`, `email`, etc.).
   - `0070_finance_category_compatibility.sql` convertit les anciennes lignes `infrastructure` vers `hosting`, remplace le CHECK et ajoute un index adapté.

5. **Référentiel des coûts amélioré**
   - Les lignes de coûts initiales peuvent maintenant être configurées directement depuis le tableau.
   - Budget FCFA/USD, activation/désactivation et audit de modification sont pris en charge.

## Points vérifiés

- `order_items.unit_cost` est renseigné lors de la création de commande depuis `products.cost_price`.
- Le COGS historique ne dépend donc pas du prix d'achat courant du catalogue.
- Les dépenses `cost_of_revenue`, `operating` et `tax` restent séparées.
- Les budgets récurrents ne sont pas confondus avec les dépenses effectivement payées.
- Les comptes de groupes WhatsApp ne gonflent plus artificiellement la facture Zernio.
- Les fichiers modifiés ont des parenthèses/accolades équilibrées.
- Le ZIP final a été contrôlé avec `unzip -t`.

## Limite de validation

L'environnement ne contient pas `node_modules`. Une installation `npm ci` a dépassé le délai d'exécution disponible. Le `tsc` global a donc seulement confirmé que les dépendances/types du projet ne sont pas installés localement ; il ne permet pas de conclure à un build Next complet.

Le build final doit être exécuté dans l'environnement de développement/deploiement avec les dépendances installées :

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```
