# Scope du MVP

Règle de décision utilisée tout du long : chaque fonctionnalité doit
contribuer à au moins une catégorie parmi ACQUISITION / CONVERSION /
OPÉRATIONS / REVENUE / FINANCE. Sinon : V2.

## Dans le MVP (construit)

1. Dashboard (KPIs : CA, dépenses, résultat, commandes, leads, clients,
   conversations à traiter, ruptures de stock, publications programmées)
2. Business Data (infos entreprise, alimentent landing/FAQ/IA/WhatsApp)
3. Catalogue (produits + services, source de vérité unique)
4. Landing Page dynamique (`/`, `/produits`, `/produits/:slug`)
5. WhatsApp via Zernio (réception, réponse, product discovery)
6. Conversation Orchestrator (règles/FAQ/catalogue/data avant IA)
7. FAQ
8. IA contrôlée (dernier recours, jamais d'invention de prix/stock)
9. Human Handoff (inbox admin, reprise, retour à l'IA, clôture)
10. CRM / Leads
11. Commandes (sans paiement intégré)
12. Gestion financière (revenus/dépenses manuels + auto depuis commandes)
13. Publications sociales via Zernio (createPost/schedulePost/publishPost/cancelPost/getAnalytics)
14. Sélection multiple de produits + campagnes programmées
15. Gestion du stock (transition automatique vers OUT_OF_STOCK, jamais de suppression)
16. Import CSV en masse
17. Paramètres / intégrations (`provider_connections`)

## Explicitement HORS MVP (ne pas construire sans revalidation du scope)

- AI Recommendations / AI Insights / recommandations personnalisées
- Analytics avancées (au-delà de : publications, vues, likes, clics, Top Publications)
- ERP, comptabilité complète, TVA, rapprochement bancaire
- Paiement intégré (CinetPay/NotchPay) — le port `PaymentProvider` existe
  dans le code mais aucun adapter concret n'est branché
- Constructeur de site drag-and-drop (la landing est dynamique mais suit
  un template fixe, pas un éditeur de sections)
- Automatisations complexes (trigger/condition/action génériques)
- Segmentation avancée, scoring de lead avancé
- Groupes WhatsApp (architecture compatible, non implémenté)
- Rendez-vous (`appointments` existe en base, module désactivable, écran
  admin non construit dans ce dépôt)

## Historique de scope

Ce projet a démarré sous une première vision (plateforme multi-tenant
générique avec Website Engine/Dashboard Engine configurables façon
page-builder, moteur d'automatisation, AI Insights). Cette vision a été
explicitement remplacée par la vision catalogue-first documentée ici — le
détail complet de cette transition, avec les raisons, est dans
`docs/GAP_ANALYSIS.md`.
