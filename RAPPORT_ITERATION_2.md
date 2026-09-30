# Itération 2 — 25/09/2026

Suite de la demande groupée du 25/09/2026 (voir RAPPORT_ITERATION_1.md).
Vérifié : typecheck / lint / **1028 tests** verts, build production **87/87 pages**
(Google Fonts stubé le temps du build, fichiers originaux restaurés — diff vide).

## 1. Commentaires unifiés — contrôle d'accès manquant (vrai bug)
- La synchro temps réel (webhook `comment.received`) et la réponse automatique
  des commentaires Facebook/Instagram/TikTok fonctionnent comme pour les messages
  (déjà en place, entitlements par plateforme vérifiés).
- L'entitlement `unified_comments` (Free 0 / Starter 0 / Pro 1) existait en base
  mais n'était vérifié NULLE PART : tous les plans accédaient à la boîte de
  réception. `/dashboard/comments` affiche maintenant un paywall hors Pro.
  ⚠ Changement de comportement : un tenant Starter qui utilisait cette page la
  perd (c'est ce que prévoit la grille de plans).

## 2. Heure de pointe (analytique vitrine)
- Nouveau bloc « Heure de pointe » sur `/dashboard/analytics/landing` : pages vues
  par heure (0h–23h), heure de pointe surlignée.
- Calculé en **heure locale du tenant** (`organizations.timezone`, défaut
  Africa/Douala), jamais en UTC brut.
- Bug intercepté par les tests avant livraison : `Intl` en `fr-FR` rend « 08 h »
  (suffixe) → `formatToParts` utilisé à la place.

## 3. Onglets par plateforme
- Composant partagé `PlatformTabs` (`?channel=`), même système pour les deux écrans.
- **Conversations** : un onglet par réseau réellement présent (WhatsApp, Facebook,
  Instagram, Telegram…) avec compteurs ; filtre côté base (chaque onglet a ses 50
  dernières conversations) ; badge réseau sur chaque ligne.
- **Analytique des publications** : onglet « Tous » inchangé ; onglet réseau =
  publications (30 j) + vues/engagements/clics/commentaires issus de l'analytique
  par publication (100 dernières).
  ⚠ Limite réelle du fournisseur : portée, impressions et nouveaux abonnés ne sont
  PAS ventilés par réseau (totaux tous réseaux uniquement) — indiqué à l'écran.

## 4. CRM — identité par plateforme + export complet
- Déjà en base : WhatsApp = numéro unique par organisation (deux homonymes de
  numéros différents sont déjà deux fiches) ; autres réseaux = `plateforme:ID`.
- Maintenant visible sur `/dashboard/leads` : badge de la plateforme, numéro ou
  ID plateforme, et une **référence unique courte** (`CT-3F9A1C2B`, dérivée de
  l'UUID, aucune migration).
- Bouton « Exporter tout le CRM (CSV) » → `/dashboard/leads/export` : TOUTES les
  lignes (pagination interne par 1000, garde-fou 50 000 signalé par en-tête
  `X-Export-Truncated`), séparateur `;` + BOM UTF-8 (ouverture correcte dans Excel
  FR), neutralisation des injections de formule (`=`, `+`, `-`, `@`).
- Chaque message entrant, sur toute plateforme, crée bien contact + prospect.
  ⚠ Un simple commentaire public ne crée PAS de fiche CRM (seul un message le fait).

## Reste à faire (itération 3)
Diffusion aux contacts : sélection manuelle des contacts un par un, produits du
catalogue, image/vidéo de couverture (catalogue ou externe). Nécessite une
migration (média + contacts ciblés sur les campagnes) et l'envoi de pièces jointes
par le connecteur de messagerie — à concevoir avant de coder.
