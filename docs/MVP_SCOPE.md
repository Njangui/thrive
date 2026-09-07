# Scope du MVP

Règle de décision utilisée tout du long : chaque fonctionnalité doit
contribuer à au moins une catégorie parmi ACQUISITION / CONVERSION /
OPÉRATIONS / REVENUE / FINANCE. Sinon : V2.

> Mis à jour lors du Lot 2 (master prompt SME-OS, §81/§98), puis à la
> fusion des Lots 1/2/4 (RAPPORT_FUSION_6.md) — ce fichier était
> significativement obsolète : plusieurs éléments listés
> "explicitement hors MVP" ci-dessous étaient en réalité déjà construits
> par des lots précédents (groupes WhatsApp, rendez-vous, paiement
> NotchPay...). Le code réel fait foi, ce fichier est réaligné dessus à
> chaque fusion — y compris quand l'écart vient du lot qui a écrit cette
> note lui-même (la galerie multi-photos listée "non construite"
> ci-dessous avait en réalité été livrée par ce même Lot 2, corrigé ici).

## Dans le MVP (construit)

1. Dashboard (KPIs : CA, dépenses, résultat, commandes, leads, clients,
   conversations à traiter, ruptures de stock, publications programmées)
2. Business Data (infos entreprise, alimentent landing/FAQ/IA/WhatsApp)
3. Catalogue — produits (CRUD, galerie multi-photos avec réordonnancement/
   photo principale, CSV, stock, SEO, promotions) et services (CRUD
   complet depuis `/dashboard/services`, Lot 2 — le backend existait déjà,
   l'écran manquait)
4. Landing Page dynamique par tenant (`/`, `/produits`, `/produits/:slug`)
   — sections activables/réordonnables, branding, témoignages, domaine
   personnalisé (`/dashboard/site`)
5. Landing marketing SME-OS (`/` sans tenant résolu, Lot 2) — remplace
   l'ancienne page de statut de développement interne, jamais destinée à
   être vue par un client
6. WhatsApp via Zernio (réception, réponse, product discovery, groupes +
   diffusion programmée)
7. Conversation Orchestrator (règles/FAQ/catalogue/data avant IA) + mémoire courte
8. FAQ
9. IA contrôlée (dernier recours, jamais d'invention de prix/stock),
   configuration depuis `/dashboard/ai`
10. Human Handoff (inbox admin, reprise, retour à l'IA, clôture)
11. CRM / Leads (`/dashboard/leads`, pagination, changement de statut)
12. Commandes (`/dashboard/orders`, pagination, détail, finalisation/
    annulation) — sans paiement intégré côté commande client
13. Gestion financière (revenus/dépenses manuels + auto depuis commandes)
14. Publications sociales via Zernio (createPost/schedulePost/publishPost/
    cancelPost/getAnalytics), sélection multiple de produits + campagnes
    programmées, commentaires (lecture/réponse/masquage)
15. Gestion du stock (transition automatique vers OUT_OF_STOCK, jamais de
    suppression, réapprovisionnement manuel via `/dashboard/products/:id/edit`),
    transaction atomique commande/stock (verrouillage de ligne, voir Lot 1)
16. Import CSV en masse
17. Groupes WhatsApp — connexion, synchronisation, diffusion programmée
    (voir `docs/ZERNIO_INTEGRATION.md` pour la limite réelle et honnête :
    un groupe jamais contacté ne peut pas encore recevoir de diffusion à
    froid, contrainte de l'API, pas un bug)
18. Rendez-vous (`/dashboard/appointments`)
19. Abonnements, plans, entitlements, crédits IA, add-ons — paiement
    plateforme via NotchPay (`/dashboard/subscription`, `/dashboard/addons`)
20. Domaines personnalisés — sous-domaine automatique, demande manuelle,
    tarification pilotée par le Super Admin
21. Équipe — invitations par email, rôles, `/dashboard/team`
22. Analytics de base (vues, clics produit, leads, commandes,
    publications — `product_click`/`conversation_started` réellement
    émis depuis cette vague, RAPPORT_FUSION_6.md) — `/dashboard` et
    Super Admin
23. Console Super Admin (`/admin/*`) — entreprises, plans, domaines,
    numéros, canaux, add-ons, logs, vue globale
24. PWA installable
25. Paramètres / intégrations (`provider_connections`)

## Explicitement HORS MVP (ne pas construire sans revalidation du scope)

- AI Recommendations / AI Insights / recommandations personnalisées
- Analytics avancées (BI, A/B testing, machine learning prédictif)
- ERP, comptabilité complète, TVA, rapprochement bancaire
- Constructeur de site drag-and-drop (sections activables/réordonnables/
  configurables, pas un éditeur libre façon Webflow — voir master prompt
  §11, décision volontaire)
- Automatisations complexes (trigger/condition/action génériques)
- Segmentation avancée, scoring de lead prédictif (le score reste
  rule-based, jamais un modèle prédictif)
- Recherche/filtre sur la liste de produits du dashboard (identifié
  Lot 2, non construit)
- Achat automatisé de domaine/numéro de téléphone auprès d'un
  fournisseur réel (le workflow manuel + l'abstraction provider existent,
  aucun registrar/opérateur n'est branché en direct)
- Gestion des FAQ et des informations business (horaires/adresse/
  téléphone) depuis un écran dashboard — les deux existent en base
  (`faqs`, colonnes dédiées sur `organizations`) et sont lues par le
  routeur IA/la landing publique, mais s'éditent aujourd'hui uniquement
  en SQL direct (identifié à la fusion des Lots 1/2/4, RAPPORT_FUSION_6.md
  — aucun des 4 lots de cette vague n'avait ce périmètre)
- Écran analytics dédié listant les publications les plus performantes
  (`SocialPublishingProvider.getAnalytics` existe côté provider, pas
  encore d'écran dashboard qui l'exploite au-delà des compteurs globaux
  de la page d'accueil)
- Telegram, messages vocaux avancés, marketplace, application mobile
  native

## Historique de scope

Ce projet a démarré sous une première vision (plateforme multi-tenant
générique avec Website Engine/Dashboard Engine configurables façon
page-builder, moteur d'automatisation, AI Insights). Cette vision a été
explicitement remplacée par la vision catalogue-first documentée ici — le
détail complet de cette transition, avec les raisons, est dans
`docs/GAP_ANALYSIS.md`.
