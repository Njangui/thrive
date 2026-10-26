# Assistant piloté par chat — vue d'ensemble

**But** : gérer l'entreprise depuis le chat (tableau de bord, Telegram, WhatsApp) sans passer par les écrans. La personne qui a les droits donne des instructions ; l'assistant exécute ; les actions sensibles sont validées par un humain ; le propriétaire règle ce qui passe seul.

## Chaîne d'une demande
message → `KernelAgentRuntime` → boucle modèle↔outils (`runtime.ts`) → `executeTool` : acteur → entrée validée → **moteur de règles** (outil activé ? zone de confiance ? rôle ? garde-fous fixes ? politique du propriétaire) → audit → exécution → sortie validée.
Carte d'approbation si validation requise ; action sensible = validation renforcée (PIN / lien tableau de bord) **liée à l'empreinte exacte des paramètres**, usage unique.

## Garde-fous fixes (aucun réglage ne les lève)
Actions `sensitive` (remboursement, annulation, prix, accès équipe, suppression de FAQ) · `confirmAlways` (message client, diffusion, publication, réponse publique, texte de FAQ, fiche entreprise, création de tâche) · envoi > 20 messages · coût > plafond par action · un employé n'a aucun outil · un client n'a aucun outil · une tâche planifiée ne gère pas les tâches.

## Réglages du propriétaire
`/dashboard/assistant/settings` : profil Prudent / Équilibré / Autonome + exceptions par action (auto jusqu'à X, toujours demander, interdit) + journal lisible.

## Domaines d'outils (`src/application/agents/domains/`)
`operations` (commandes, stock, produits/prix, rendez-vous, finances, clients) · `commerce` (catalogue, prospects, conversations) · `marketing` (diffusions, publications, commentaires) · `admin` (équipe, FAQ, fiche entreprise, alertes, abonnement/crédits en lecture) · `tasks` (tâches planifiées) · `site` (générateur de site libre, versions et retour arrière) · `assistant` (agent principal, enregistré en dernier). Détail et rôles : `ROLE_TOOL_MATRIX.md`.

## Mise en service (checklist)
1. Appliquer les migrations `0195`, `0196` et `0197` (historique fin du site).
2. Variables : `AGENT_RUNTIME_ENABLED=true`, `STEP_UP_PIN_PEPPER`, clés du fournisseur IA (Mistral), `CRON_SECRET` ; planifier `/api/cron/agents-tick` toutes les 5 min.
3. Définir son PIN (écran Sécurité) avant de valider une action sensible.
4. Tester sur staging avec le vrai modèle (non vérifié à ce jour) : tool-calling Mistral, flux PIN complet, cron, rendu des écrans.

## Tests
`src/infrastructure/agents/assistant-e2e.test.ts` : 20 scénarios de bout en bout avec modèle scripté (injection, élévation de droits, PIN lié à l'action, falsification de paramètres, isolation entre entreprises, boucles, tâches planifiées). Des mutations volontaires (suppression du garde-fou `confirmAlways`, PIN toujours accepté) font échouer ces tests : ils ne sont pas vides.

## Générateur de site libre (étape 7)
- **Opt-in** : un site existant par gabarit sectoriel n'est pas touché. L'opération `set_mode: free` (via `site.edit`) convertit l'accueil du **brouillon** (hero → `rich_hero`, `cta`/`booking` non repris, sections de données conservées). Le retour au gabarit se fait en restaurant une version précédente.
- **Blocs riches** (données, pas de code) : `rich_hero`, `rich_text`, `feature_grid`, `image_text`, `steps`, `stats`, `pricing`, `quotes`, `cta_band`, `faq_list`, `image_gallery`, `divider` + sections de données (produits, services, FAQ, contact…). Schéma strict : liens `/…` ou https, médias https, alt obligatoire sur les images de contenu, plafonds (40 blocs/page, 30 pages). Rendu par `storefront/rich-blocks.tsx` (texte échappé par React ; un test interdit `dangerouslySetInnerHTML`).
- **Historique** : chaque modification du brouillon (manuelle ou assistant) crée une étape dans `site_revisions` (état de départ + une ligne par modification, 100 max par version). `site.revert` / bouton « Revenir à cette étape » remet le brouillon dans cet état et ajoute une étape (annulable). Les versions publiées/archivées restent immuables ; publier archive l'ancienne, restaurer recrée un brouillon.
- **Publication** : `site.publish` est sensible (validation + PIN) et bloquée par le contrôle SEO critique ; nouveaux avertissements : un seul titre principal par page, hero sur l'accueil.
- **Non vérifié** : rendu visuel réel des blocs (aucun test Playwright/`next build` possible ici), qualité des sites composés par le vrai modèle Mistral (un modèle « small » à 8 pas), conversion gabarit → libre sur de vrais tenants.
