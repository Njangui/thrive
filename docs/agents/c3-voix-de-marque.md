# C3 — Voix de marque et messages prédéfinis (étape 4a · livrable E)

Branche : `agents/c3-assistant-client` · Migration : `0142_c3_brand_voice.sql` · Prérequis : étapes 1 et 2.

## Ce que ça fait
L'assistant parle **comme le commerçant**, et les messages de routine ne coûtent plus rien (aucun appel au modèle).

1. **Profil de voix par entreprise** (`brand_voice_profiles`) : tutoiement / vouvoiement, niveau d'emojis (aucun / léger / riche), expressions locales (≤ 10), expressions à éviter (≤ 20), jusqu'à 10 vrais messages en exemple **avec consentement explicite**.
2. **Bibliothèque de messages prédéfinis** (`message-library.ts`) : accueil, merci, au revoir, « je vérifie », introductions de listes et de recherches, catégories, « voir tout ». Chaque message existe en tu et en vous ; les emojis sont des jetons rendus selon le niveau. **Sans profil, le rendu est identique, caractère pour caractère, aux anciens textes** (test de non-régression).
3. **Surcharges du commerçant** (`predefined_messages`) : il remplace n'importe quel message par SA formulation. Seules les surcharges `approved` ET valides sont utilisées ; sinon, retour au défaut. Un texte qui contient un prix, une promesse de gratuité, un numéro, un email, un lien en dur, une variable inconnue ou un ton incohérent est refusé.
4. **Dans le prompt de rédaction** : consignes de ton (registre, emojis, expressions) ; les exemples ne sont inclus que si le consentement est donné.
5. **Dans le contrôle qualité** : le modèle suit la voix ou sa réponse est écartée (`register_mismatch`, `avoid_expression`, `emoji_excess`) → repli déterministe dans la voix du commerçant.

## Ce qui n'est PAS dans cette étape
- **Pas d'interface de saisie.** `saveBrandVoice`, `saveApprovedMessage`, `removeMessageOverride` sont des services protégés (propriétaire / administrateur du tenant). Il reste à les brancher : écran du dashboard (`/dashboard/ai`) ou outil de chat C2.
- **Pas de génération de variantes par le modèle** (« générée une fois puis validée » dans le brief). Les colonnes `source = 'llm'` et `status = 'draft'` existent déjà ; la génération (avec contrôle des variables) et l'écran d'approbation viendront avec la FAQ qui apprend.
- **Messages encore codés en dur** hors périmètre de cette étape : accusé de réception d'escalade (`inbound-auto-reply-service`), messages de relance, réponses aux commentaires publics, texte « catalogue vide ». À migrer ensuite.
- **Mémoire tenant C1** : le brief prévoit d'y stocker le profil ; elle n'existe pas encore, donc table dédiée (même colonnes, migration simple le moment venu).

## Données et légal (loi n° 2024/017)
- Les **exemples de messages** sont envoyés au fournisseur IA dans le prompt. Ils n'existent que si `examples_consent = true` (contrainte SQL, pas seulement du code), la date du consentement est conservée, retirer le consentement efface les exemples, et emails / numéros / liens sont retirés avant stockage. **À faire valider par un juriste** (texte de consentement affiché au commerçant, transfert hors du Cameroun). Voir `c3-donnees-externes.md`.
- Les exemples sont rédigés par le commerçant : il lui est demandé de ne coller aucun message contenant des données personnelles de clients ; le retrait automatique est un filet, pas une garantie (un prénom reste, par exemple).

## Choix à valider
- Défauts : vouvoiement, emojis légers (= comportement historique).
- Plafond d'emojis : 0 / 2 / 6 selon le niveau.
- Détection du tutoiement / vouvoiement par mots (« tu, toi, ton… » / « vous, votre… ») : simple et sans faux positif sur les tests, mais un nom de produit contenant « Ton » ou « Vous » déclencherait un rejet (repli sûr).
- Intros de liste neutres (« Bien sûr ! Voici quelques-uns de nos produits disponibles ») identiques en tu et vous.

## Comment tester
- Unitaires : `npm test` (`brand-voice`, `message-library`, `message-library-service`, `product-reply-format`, `reply-quality`, `assistant-turn-service`, `conversation-orchestrator`).
- SQL réel : `npm run test:integration` avec les 3 variables `SUPABASE_TEST_*` (`tests/integration/c3-brand-voice.test.ts` : consentement obligatoire, contraintes, unicité, RLS anonyme, cascade). Les politiques propriétaire / membre nécessitent des sessions par rôle : à ajouter à `tenant-isolation.test.ts`.
- Déploiement : appliquer `0142` ; sans elle, `loadVoiceAndLibrary` retombe sur la voix par défaut (jamais d'erreur côté client).
