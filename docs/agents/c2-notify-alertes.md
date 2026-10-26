# C2 — `notify()`, alertes propriétaire, heures calmes, escalade (étape 4)

## Ce que ça fait
- `raiseAlert({organizationId, trigger, title, body?, url?, dedupeKey?, value?})` : point d'entrée pour tous les modules (C1/C3/C5/C2). Vérifie déclencheur activé, seuil, déduplication (index unique partiel sur alertes vivantes), heures calmes (fuseau de l'entreprise), puis lance le palier 0.
- `notify()` : envoi multi-canal (push ciblé par utilisateur, Telegram, WhatsApp, email), chaque canal isolé, chaque tentative journalisée dans `alert_deliveries`.
- `processDueAlerts()` (cron `/api/cron/process-alerts`, **toutes les minutes**, `CRON_SECRET`) : relâche les alertes retenues, fait monter l'échelle. Réclamation atomique par palier (pas de double envoi si deux passes se chevauchent).
- `acknowledgeAlert()` : propriétaire/admin ou personne de repli ; via dashboard (`/dashboard/alerts`) ou bouton Telegram « J'ai vu » (`al:a:<id>`). Idempotent.

## Échelle
0 push (+ in-app) aux owner/admin → (délai N min, défaut 15, 1–1440) → 1 Telegram / WhatsApp / email aux owner/admin → (N min) → 2 personne de repli, tous canaux → (N min) → expirée.
- Push non reçu (0 appareil) : palier 1 immédiat. Pas de personne de repli : palier 2 sauté.
- `info` : un seul push, aucune escalade. `critical` : traverse les heures calmes. Aucun appel téléphonique.

## Déclencheurs (défauts)
Actifs : commande suspecte, remboursement au-dessus du seuil (critique), rupture produit phare, panne (critique). Inactifs tant que le producteur n'existe pas : dépense pub anormale (C5), client mécontent (C3). **Aucun seuil en XAF codé en dur** : sans seuil configuré, l'alerte est levée.

## Branchements à faire par les autres claudes
- C1 / C5 / C3 appellent `raiseAlert` avec leur clé de déclencheur (`ALERT_TRIGGERS`).
- WhatsApp : étape 5 appelle `registerAlertWhatsApp(port)` ; d'ici là le canal est journalisé `skipped`.

## Données envoyées à des tiers (à valider conformité, loi 2024/017)
Titre + texte de l'alerte (peuvent citer un client/montant) → service push du navigateur (FCM/Apple/Mozilla), API Telegram, Resend (email), Zernio/Meta (WhatsApp). Email : HTML échappé ; liens uniquement relatifs à l'application.

## Limites / risques
- Dépend du cron minute : sans lui, rien ne monte ni ne se relâche (le palier 0 reste immédiat).
- Telegram des alertes passe par le bot plateforme ; un membre qui a bloqué le bot → `failed` journalisé, l'escalade continue.
- Alertes vivantes jamais accusées expirent après le palier 2 (libère la déduplication).
- Heures calmes : fenêtre [début, fin), fuseau `organizations.timezone` (repli UTC si invalide).
- Tests sur FakeDb (pas de Postgres réel) ; migration 0123 à appliquer en staging.
