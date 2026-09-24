# tokoo  — Finance Super Admin & calculateur Zernio

## Ajouts

- `/admin` enrichi : revenus SaaS, dépenses, résultat, abonnés par plan, graphiques 30 jours et estimation Zernio.
- Nouvelle page `/admin/finance` : détail du coût Zernio, taux USD/FCFA de pilotage, saisie des dépenses internes et historique.
- Nouvelle table `platform_expenses` via migration `0068_platform_finance_and_zernio_costs.sql`.
- Le coût Zernio est calculé à partir des comptes Zernio actuellement connectés dans tokoo  : `social_accounts`, `whatsapp_accounts` et les connexions dédiées aux groupes WhatsApp. Les chaînes YouTube ne sont pas comptées car tokoo  les connecte via son intégration Google directe.
- Tarification graduée intégrée : 2 comptes gratuits, comptes 3–10 à 6 USD, 11–100 à 3 USD, 101+ à 1 USD par compte/mois. Le calcul suit la tarification publiée par Zernio et ne mélange pas les frais d'usage supplémentaires.
- Le taux USD/FCFA est un réglage de pilotage interne, modifiable depuis `/admin/finance`. Il ne prétend pas être le taux effectivement appliqué par la banque ou Zernio.
- Les revenus SaaS proviennent des `subscription_payments` confirmés ; ils ne sont pas mélangés aux revenus des boutiques clientes.
- Les dépenses saisies dans `platform_expenses` sont distinctes de l'estimation Zernio pour éviter de présenter une estimation comme une facture réellement payée.
- L'ancienne pastille « S / tokoo  Admin » du menu admin mobile a été remplacée par le vrai composant de marque tokoo .
- Les pages admin `Canaux` et `Paiements` ont été reprises avec les primitives visuelles de la console.
- La page `Devenir affilié` explique maintenant explicitement l'existence des codes promo et, lorsqu'un affilié est actif, affiche ses codes issus de ses liens actifs.

## Source de tarification Zernio

Documentation officielle consultée le 22 septembre 2026 :
https://docs.zernio.com/pricing

Le calculateur applique la tarification graduée publiée par Zernio. La documentation indique également que les comptes WhatsApp sont comptés comme des comptes connectés et que les profils eux-mêmes ne sont pas facturés.

## Validation

- `tsc --noEmit` a été exécuté dans l'environnement fourni. Les erreurs restantes sont les erreurs globales déjà attendues dues à l'absence de `node_modules` (Next, React, Playwright, etc.). Aucun diagnostic TypeScript spécifique aux nouveaux fichiers n'a été relevé au-delà de ces modules manquants.
- Le test unitaire `admin-finance-service.test.ts` couvre les seuils Zernio 2, 3, 10, 11, 20, 100 et 101 comptes.
- Le build Next.js complet et le rendu navigateur n'ont pas été exécutés dans cet environnement sans dépendances installées.
