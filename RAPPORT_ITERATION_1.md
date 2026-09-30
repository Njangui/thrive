# Itération 1 — 25/09/2026

Réponse à la demande groupée du 25/09/2026 (catalogue, Zernio hors front,
déconnexion des canaux, adaptation sectorielle, diagnostic "Mon site"/Pro et
relance client). Traité **doucement, par itération, avec vérification
réelle** — cette livraison couvre une partie du périmètre demandé ; le reste
suit dans une prochaine itération (voir "Reste à faire" en bas).

## Corrigé et vérifié

### 1. Catalogue — plusieurs photos + choix Photos/Vidéo à la création
- `products/new` et `services/new` n'acceptaient qu'**une seule photo** à la
  création (`ImageUploadField`), alors que la fiche d'édition permet déjà
  d'en ajouter plusieurs à la fois (`product_images`/`service_images`,
  `appendProductImages`/`appendServiceImages`, existant).
- Nouveau composant `NewCatalogMediaField` (`src/app/_components/`) : choix
  Photos (upload multiple + collage de liens) / Vidéo dès la création.
- En mode Vidéo : le produit/service est d'abord créé (la vidéo doit se
  rattacher à un identifiant existant), puis redirection directe vers sa
  fiche avec bannière "Envoyez sa vidéo ci-dessous" et ancre `#videos`.
- Bug évité au passage : ne pas dupliquer la 1ère photo dans la galerie
  (createProduct/createService l'auraient déjà ajoutée en interne).

### 2. "Ne jamais mentionner Zernio dans le front"
Toutes les fuites réellement affichées au commerçant corrigées : panneau
vidéo catalogue (3 messages), erreur d'upload vidéo, page Analytics, page
Canaux (x2), avertissement de programmation de publication (composeur
omnicanal, x2), message d'échec de diffusion groupe WhatsApp (visible sur
le détail de diffusion), + nettoyage préventif d'un libellé de module
interne non encore affiché nulle part.

### 3. Adaptation sectorielle — "je vois commandes, je vois stock critique"
Cause réelle : ce n'était PAS la config des modules par secteur (déjà
correcte pour l'immobilier), mais la page d'accueil du tableau de bord
(`/dashboard`) qui affichait "Commandes (30j)", "Commandes récentes" et
"Stock critique" **sans jamais vérifier les modules activés**, contrairement
au reste de la page. Corrigé : ces 3 blocs respectent maintenant
`enabledModules`.

### 4. Bouton de déconnexion des canaux
Ajouté pour les comptes sociaux (Facebook/Instagram/LinkedIn/TikTok) et les
numéros WhatsApp — aucun des deux n'avait de déconnexion possible avant.
Piège réel évité : la page Canaux resynchronise automatiquement les comptes
sociaux depuis Zernio à CHAQUE chargement — sans précaution, ça aurait
annulé silencieusement toute déconnexion au rechargement suivant. La
synchro respecte maintenant un statut "disconnected" posé par le
commerçant (la reconnexion explicite, elle, continue de fonctionner).
Sécurité : vérification d'appartenance à l'organisation ajoutée (IDOR).

### Bonus — 2 bugs réels trouvés en vérifiant (sans rapport avec la demande)
- Test du webhook Zernio (réception WhatsApp) cassé par un mock de test
  incomplet — corrigé, pipeline réel de réception/réponse auto reconfirmé.
- `platform_costs`/`platform_expenses` échappaient au filet de sécurité RLS
  statique (préfixe `public.` non géré par les regex du test) — migration
  corrigée + regex du test durcies pour empêcher toute récidive future.

## Diagnostiqué (pas un bug de code)

- **"Mon site" bloqué en Pro** : le contrôle d'accès (migrations,
  `canUseFeature`, gating de la page) est vérifié correct de bout en bout.
  Très probablement un écart de donnée sur le tenant de test (son
  `plan_key` réel). Vérifiable/corrigeable directement sur
  `/admin/organizations` (Super Admin), champ "Plan".
- **Relance client** : existe réellement et fonctionne (scoring 24h/48h,
  envoi réel, notification admin, visible sur la page Clients), documentée
  dans la checklist des 8 crons cron-job.org. Si elle ne se déclenche pas :
  vérifier que `/api/cron/process-follow-ups` y est bien programmé.

## Vérifié (comme d'habitude)
typecheck / lint / **1008 tests** tous verts, build production **86/86
pages** (Google Fonts stubé le temps du build à cause du bac à sable, fichiers
originaux restaurés à l'identique avant livraison — vérifié par diff vide).

## Reste à faire (prochaine itération)
Commentaires (synchro/réponse auto — à auditer précisément), heure de pointe
dans l'analytique vitrine, onglets par plateforme (conversations +
publications), CRM (identifiants uniques par plateforme + export), diffusion
(sélection contacts/produits + média externe).
