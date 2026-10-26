# C2 — Back-office WhatsApp via Zernio (étape 5)

## Principe
Le numéro WhatsApp du tenant est **public**. Le personnel est reconnu par **son numéro** (fourni par Meta/Zernio dans le webhook signé), relié à un membership par un code à usage unique envoyé **depuis ce numéro** : `LIER CODE`. Le code est généré dans `/dashboard/security/whatsapp` (réutilise `channel_link_codes` de l'étape 1, 10 min, usage unique, 5 tentatives/min). Jamais de numéro saisi à la main : l'expéditeur est la preuve.

## Routage (webhook Zernio)
Pour un `message.received` WhatsApp, **avant** la politique d'offre et le pipeline client (C3) : `handleWhatsAppBackoffice`.
- Mode **partagé** (`enabled`) : numéro lié et actif → agent de pilotage ; sinon → pipeline client inchangé.
- Mode **dédié** (`dedicated_account_id`) : tout message reçu sur ce numéro est du pilotage ; un numéro non lié reçoit un refus et **n'atteint jamais** le pipeline client.
- Back-office désactivé : rien ne change pour personne.
- Un message du personnel n'est **jamais** enregistré dans le CRM ni vu par l'IA client ; si le back-office plante, l'événement est marqué `failed` et **n'est pas** rendu au pipeline client.
- Rôle relu à chaque message, révocation immédiate (`/deconnecter`, dashboard), identité `pending` ne résout jamais.

## Sécurité : échange de SIM
Celui qui prend le numéro devient « le membre » pour WhatsApp. Donc **aucune action sensible ne se valide sur WhatsApp** : ni PIN (un message WhatsApp ne peut pas être supprimé du chat, contrairement à Telegram), ni bouton d'approbation. La carte affiche le résumé et un unique bouton « Ouvrir le tableau de bord » (lien de validation C1 si émis, sinon l'assistant). La validation exige une session dashboard (+ PIN selon les règles de C1). Le canal WhatsApp reste donc limité à la lecture et aux actions que les règles de C1 ne marquent pas `sensitive`.

## Modèles (hors fenêtre de 24 h) — API confirmée (docs.zernio.com, oct. 2026)
- Création : `POST /v1/whatsapp/templates` ; liste : `GET /v1/whatsapp/templates?accountId=` ; envoi : `POST /v1/inbox/conversations` (`participantId` sans `+`, `templateName`, `templateLanguage` identique à la création, `templateParams` tableau plat). Seul `APPROVED` est envoyable.
- Catalogue (`whatsapp-templates.ts`, catégorie UTILITY, français) : `flexco_alerte_v1`, `flexco_validation_v1`, `flexco_bilan_v1`. Bouton « Envoyer les modèles à Meta » (idempotent), « Actualiser » (sync), webhook `whatsapp.template.status_updated` (statut + raison ; refus/suspension → notification aux propriétaires).
- `sendWhatsAppToMember` : fenêtre ouverte (dernier message entrant < 24 h) → message libre (+1 bouton lien) ; sinon modèle APPROVED ; sinon `skipped` — jamais d'envoi hors règles. C'est aussi le port WhatsApp de `notify()` (étape 4) : les alertes WhatsApp fonctionnent désormais, et « VU » accuse l'alerte.
- Pour C1 (bilan du jour) : appeler `sendWhatsAppToMember({template:{key:"daily_summary", values:[…]}})`.

## Diagnostic de canal (bannière dashboard, propriétaires/admins)
Sources : `message.failed` WhatsApp (classé : paiement / fenêtre / autre), `whatsapp.account.status_updated` (restriction), `.quality_updated` (qualité rouge), `.alert_received` (alerte critique < 7 j), modèles refusés/suspendus.
**À confirmer** : il n'existe pas d'événement « moyen de paiement Meta manquant » chez Zernio (seul un 402 à la connexion est documenté). La présomption repose sur le code d'erreur Meta `131042` / mots-clés dans le texte d'erreur ; elle est affichée comme **présomption**.

## Données envoyées à des tiers (à valider conformité, loi 2024/017)
Message de l'utilisateur et réponse de l'assistant transitent par Zernio et Meta (comme tout WhatsApp). Les variables de modèle (titre/texte d'alerte) partent vers Meta. Table `whatsapp_delivery_failures` : texte d'erreur tronqué, aucun contenu de message.

## Limites / risques
- Format exact du payload `whatsapp.template.status_updated` (nom du modèle) non confirmé : sans nom/id, on resynchronise via l'API plutôt que de deviner.
- Le tour d'agent s'exécute dans la requête du webhook (limite 60 s) ; une file serait plus robuste (même limite que Telegram).
- Vocaux et pièces jointes : réponse explicative ; les vocaux seront traités à l'étape 7 (SpeechPort de C3).
- Meta peut recatégoriser un modèle UTILITY en MARKETING (événement `category_updated` non exploité).
- Mode partagé : un membre du personnel qui écrit en tant que client est traité comme personnel (documenté sur l'écran d'activation).
- Tests sur FakeDb et mocks Zernio, pas de WhatsApp réel : migration 0124 à appliquer en staging, test avec un vrai numéro avant production.
