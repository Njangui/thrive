# flexco  — Fusion complète V22

## Sources fusionnées

Cette version combine :

1. Le socle `flexco -financial-system-v21` : cockpit financier plateforme + finance tenant + calcul Zernio + coûts récurrents + P&L.
2. `flexco -fusionne-24.zip` fourni par l'utilisateur : socle applicatif le plus récent avant les lots supplémentaires.
3. Lot P : amélioration du moteur conversationnel, compréhension déterministe des intentions, contexte sectoriel, reprise automatique de l'IA après prise en main humaine, nouveaux écrans conversations/IA et mappings webhook.
4. Lot 4 : résolution du prix d'abonnement selon le pays et diagnostic/correctif de dérive `plan_prices`.
5. Lot 24 commentaires : tracking des posts sociaux et gestion des commentaires.

## Numérotation des migrations

Le socle s'arrêtait à `0067`.

- `0068_platform_finance_and_zernio_costs.sql` — coûts plateforme + Zernio
- `0069_complete_financial_system.sql` — COGS, marges, coûts récurrents, P&L
- `0070_ai_handoff_auto_resume.sql` — pause/reprise automatique IA
- `0071_fix_plan_prices_drift.sql` — diagnostic et réalignement des prix pays

Le fichier Lot P original `0068_ai_handoff_auto_resume.sql` a été renuméroté en `0070` pour éviter une collision avec le système financier.

## Finance plateforme

Le Super Admin dispose de :

- CA brut, remboursements, CA net
- coût de revient
- bénéfice brut et marge brute
- charges d'exploitation
- résultat d'exploitation
- taxes
- bénéfice net et marge nette
- revenus par plan
- abonnés par plan
- tendance revenus / dépenses / résultat
- historique 12 mois
- répartition des dépenses
- coûts récurrents/engagements séparés des dépenses réellement payées
- estimation Zernio selon les comptes connectés

Les postes de coûts suivis incluent notamment hébergement, base de données, stockage, e-mail, IA, paiement, domaines, téléphonie, marketing, affiliation, salaires, juridique, comptabilité et monitoring.

## Finance tenant

Les commandes figent `order_items.unit_cost` afin de conserver une marge historique cohérente. Le tenant peut distinguer CA, encaissements, COGS, bénéfice brut, marge brute, charges, résultat et bénéfice net.

## Validation effectuée

- Vérification des chemins d'import locaux : aucune résolution locale manquante détectée.
- Vérification des migrations : séquence 0068 → 0071 sans collision.
- Vérification du ZIP final avec `unzip -t`.
- Installation `npm ci` tentée, mais l'environnement a interrompu l'opération avant la fin ; le build Next.js complet n'est donc pas déclaré comme validé ici.
