# C2 — Canaux & back-office : rapport final

Branche `agents/c2-canaux`, migrations 0120–0125. Docs détaillées : `c2-identite-stepup`, `c2-chat-dashboard`, `c2-telegram-backoffice`, `c2-notify-alertes`, `c2-whatsapp-backoffice`, `c2-outils-operations`, `c2-vocaux`.

## Fait
| Livrable | Contenu |
|---|---|
| D. StepUp + identités | `channel_identities`, codes de liaison à usage unique, PIN scrypt (limitation, verrouillage), défis liés à l'empreinte de l'action, validation par lien dashboard / bouton Telegram, jamais sur WhatsApp |
| A. Chat dashboard | flux NDJSON, historique, cartes d'approbation (valider / modifier / refuser), pièces jointes, dictée vocale |
| B. Telegram | liaison `/start CODE`, révocation, acteur relu à chaque message, boutons d'approbation, PIN supprimé du chat, vocaux |
| E. notify() + alertes | échelle push → Telegram/WhatsApp/email → personne de repli → expiré, heures calmes, critique les ignore, dédoublonnage, cron chaque minute |
| C. WhatsApp back-office | liaison par numéro expéditeur, mode partagé ou dédié, fenêtre 24 h, modèles approuvés (création + suivi), bannière de diagnostic |
| G. Outils Opérations | 20 outils typés (9 lecture, 8 écriture réversible, 3 sensibles : annulation, remboursement, prix), rôle vérifié avant tout appel |
| F. Vocaux | audio → `SpeechPort` (C3) → texte → même flux ; PIN dicté bloqué ; rien ne se valide à la voix |
| Critères d'acceptation | `src/application/acceptance/c2-acceptance.test.ts` : liaison, rôle relu, révocation, outil hors rôle (3 canaux), approbation Telegram, remboursement + seuil, modèle WhatsApp hors fenêtre |

Tests : 1606 passent ; 7 échecs préexistants (`catalog-video-retention`, `fapshi/client`) hors périmètre. ESLint 0 erreur sur le code C2.

## Décisions de Marc-well (réponse « oui à tout », interprétées)
- Vocaux : 2 minutes max ; Voxtral via C3 ; **audio non conservé** (voir question 1).
- Remboursements : domaine conçu ; PIN toujours, approbateur supérieur au-dessus du seuil ; seuil défini par le propriétaire (aucune valeur en dur).
- Conservés tels quels : `orders.complete` réversible (action de caisse courante) ; manager autorisé à changer un prix (comme dans le dashboard), toujours confirmé ; cron d'alertes chaque minute.

## Pas fait
- Livraisons : aucun module/table dans le dépôt (pas d'outils `deliveries.*`).
- Dépense depuis photo de reçu (second temps prévu au brief).
- Synthèse vocale (hors périmètre C2) ; appels téléphoniques (hors périmètre).
- Réinitialisation du PIN par un tiers : politique à décider (question 3).
- Stockage privé des pièces jointes du chat : bucket public actuellement (migration vers R2 privé = C4).

## Risques
1. **Miroirs locaux** : contrat C1 (`ops-contract.ts`, `agent-runtime-port.ts`) et `SpeechPort` de C3. À remplacer au merge ; `ContractRuntime` des tests de bout en bout est un substitut, pas C1.
2. **Comptabilité des remboursements** : contre-passation négative sans `order_id` — à valider par un comptable.
3. **Données vers l'extérieur** (loi 2024/017) : audio → transcription ; textes et noms de produits/clients (téléphones masqués) → fournisseur LLM. Transferts hors du Cameroun à encadrer, consentement à recueillir.
4. **Échange de SIM** : toute validation sensible est exclue de WhatsApp.
5. **API externes non confirmées** : format réel des vocaux WhatsApp via Zernio, URL média, règles Meta de facturation/paiement (brief : « à confirmer »).
6. `products.setPrice` : lecture-réécriture (écrasement possible en cas de modification simultanée, fenêtre courte).
7. Pas de test contre un vrai Postgres pour les migrations 0120–0125 (aucune base disponible ici) : **à appliquer d'abord en staging**.

## À faire par Marc-well avant mise en service
1. Appliquer les migrations 0120 → 0125 en staging (la 0125 contient `record_order_refund`).
2. Variables : `STEP_UP_PIN_PEPPER` (≥ 16 caractères), `TELEGRAM_BOT_TOKEN`, `CRON_SECRET` (cron `/api/cron/process-alerts` chaque minute).
3. Tester un bot et un numéro WhatsApp réels (liaison, alerte hors fenêtre, vocal) une fois C3 branché.

## Questions ouvertes pour Marc-well
1. **Rétention de l'audio** : ta réponse « oui » peut signifier « conserver ». Je recommande **non** (minimisation, loi 2024/017) et j'ai laissé « non conservé » : confirme, ou donne une durée.
2. **WhatsApp** : numéro dédié au back-office (recommandé : un inconnu n'atteint jamais le pipeline client) ou partagé (défaut actuel) ?
3. **Réinitialisation du PIN** : l'effacement par un owner/admin existe déjà (dashboard Sécurité, journalisé `STEP_UP_PIN_RESET`). Reste à décider le cas du propriétaire qui oublie son propre PIN (proposition : lien par email + délai de 24 h avec alerte aux autres admins, non construit). Valides-tu ?
4. **Déclencheurs d'alerte par défaut** : actifs = commande suspecte, remboursement, rupture du produit phare, panne ; inactifs = dépense pub anormale, client mécontent (producteurs C5/C3 pas encore livrés). OK ?
5. **Seuil de remboursement** : à fixer par l'entreprise dans Alertes ; veux-tu une suggestion de valeur par défaut à l'onboarding (je déconseille, modèle de prix non décidé) ?
