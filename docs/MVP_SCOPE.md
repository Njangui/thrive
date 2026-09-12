# Scope du MVP

Règle de décision utilisée tout du long : chaque fonctionnalité doit
contribuer à au moins une catégorie parmi ACQUISITION / CONVERSION /
OPÉRATIONS / REVENUE / FINANCE. Sinon : V2.

**Mise à jour Lot 3 (audit master prompt SME-OS §81/§98)** : ce document
était devenu obsolète sur plusieurs points — il affirmait "non construit"
pour des fonctionnalités livrées depuis dans d'autres lots. Le code réel
fait foi ; corrigé ci-dessous. Voir `RAPPORT_LOT_3.md` pour le détail de
l'audit qui a motivé cette mise à jour.

## Dans le MVP (construit)

1. Dashboard (KPIs : CA, dépenses, résultat, commandes, leads, clients,
   conversations à traiter, ruptures de stock, publications programmées)
2. Business Data (infos entreprise, alimentent landing/FAQ/IA/WhatsApp)
3. Catalogue produits (source de vérité unique) — **prestations
   (`services`) : table DB et RLS existent, mais aucune couche
   applicative/UI dashboard/intégration au router IA — voir "Connu
   incomplet" ci-dessous**
4. Landing Page dynamique, sections configurables par le tenant, presets
   sectoriels, SEO tenant-aware (title/description/OG/canonical/sitemap)
5. WhatsApp via Zernio (réception, réponse, product discovery, mémoire
   conversationnelle courte)
6. **Groupes WhatsApp** (connexion/synchronisation, diffusion programmée
   vers plusieurs groupes/produits, cron de traitement, historique/retry)
   — construit (Lot F), contrairement à ce que ce document affirmait
   auparavant
7. Conversation Orchestrator (règles/FAQ/catalogue/data avant IA),
   handoff humain (inbox admin, reprise, retour à l'IA, clôture) — garde-
   fou anti-réponse-automatique pendant une prise en charge humaine
   ajouté en Lot 3
8. FAQ (résolveur + routage prioritaire avant l'IA) — **backend
   fonctionnel, mais aucune interface dashboard pour créer/éditer une
   entrée : voir "Connu incomplet"**
9. IA contrôlée (dernier recours, jamais d'invention de prix/stock),
   crédits IA à consommation atomique (Lot 3 — corrige une race
   condition), fallback multi-provider
10. CRM / Leads
11. Commandes (sans paiement intégré côté client final)
12. Gestion financière (revenus/dépenses manuels + auto depuis commandes)
13. Publications sociales via Zernio (createPost/schedulePost/
    publishPost/cancelPost/getAnalytics), commentaires Facebook/Instagram
    (lecture/réponse/masquage, suggestion IA)
14. Sélection multiple de produits + campagnes programmées ; suspension
    automatique des publications programmées d'un produit en rupture de
    stock — jamais marquée "en pause" sans confirmation réelle côté
    provider (corrigé Lot 3, voir RAPPORT_LOT_3.md)
15. Gestion du stock (transition automatique vers OUT_OF_STOCK, jamais de
    suppression)
16. Import CSV en masse (rapport ligne par ligne)
17. Paramètres / intégrations (`provider_connections`)
18. **Paiement d'abonnement plateforme via NotchPay** — construit (Lot
    G), contrairement à ce que ce document affirmait auparavant ; webhook
    vérifié + re-vérification API avant tout crédit
19. Add-ons, facturation récurrente (relance J-3, passage `past_due`),
    Super Admin (organisations/plans/add-ons/domaines/numéros/canaux/logs)
20. Domaines : tarification + demande manuelle (Lot G), recherche/
    disponibilité réelle via OpenProvider quand configuré, repli manuel
    sinon (Lot N)
21. Credentials par tenant (compte Zernio/IA dédié par organisation,
    Supabase Vault) — Lot N
22. Notifications in-app + push web ; onboarding reprenable ; PWA
    installable

## Connu incomplet (construit partiellement — pas un mensonge, une limite documentée)

- **FAQ sans interface de gestion** : le mécanisme fonctionne
  (résolution + priorité avant l'IA), mais rien ne permet à un
  commerçant d'en créer une depuis le dashboard. Backend seul,
  fonctionnellement inatteignable par un vrai utilisateur.
- **Prestations (`services`)** : table DB prête, zéro service
  applicatif, zéro UI, zéro intégration au router IA (contrairement aux
  produits, qui ont tout ça).
- **Messages texte uniquement** : ni la découverte produit en
  conversation ni les diffusions de groupe n'envoient d'image, alors que
  Zernio le supporte (`attachmentUrl`/`attachmentType` confirmés).
- **Publication sociale non scopée par profil Zernio** (`profileId`) en
  dehors de `listAccounts()` (corrigé en Lot 3 spécifiquement pour le
  comptage d'entitlement) — les autres appels (`createPost`, etc.)
  restent sûrs selon la doc Zernio (validation d'appartenance côté
  fournisseur), mais l'architecture multi-tenant complète décrite par
  Zernio n'est pas retranscrite partout. Voir RAPPORT_LOT_3.md, section
  "Risques production".

## Explicitement HORS MVP (ne pas construire sans revalidation du scope)

- AI Recommendations / AI Insights / recommandations personnalisées
- Analytics avancées (au-delà de : publications, vues, likes, clics, Top
  Publications)
- ERP, comptabilité complète, TVA, rapprochement bancaire
- Constructeur de site drag-and-drop (la landing est configurable par
  sections activables/réordonnables, pas un éditeur de mise en page libre)
- Automatisations complexes (trigger/condition/action génériques)
- Segmentation avancée, scoring de lead avancé
- Telegram, messages vocaux avancés, marketplace, application mobile
  native

## Historique de scope

Ce projet a démarré sous une première vision (plateforme multi-tenant
générique avec Website Engine/Dashboard Engine configurables façon
page-builder, moteur d'automatisation, AI Insights). Cette vision a été
explicitement remplacée par la vision catalogue-first documentée ici — le
détail complet de cette transition, avec les raisons, est dans
`docs/GAP_ANALYSIS.md` (lui-même partiellement obsolète depuis — se fier
au code réel, section "Ce qui existe déjà" de chaque service).
