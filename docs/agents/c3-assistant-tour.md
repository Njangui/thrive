# C3 — Tour d'assistant client (étape 2) : compréhension, contrôle qualité, anti-injection

Branche : `agents/c3-assistant-client` · Prérequis : étape 1 (`0140`, parseur, recherche classée). Aucune migration.

## Où ça se place
`routeMessage` garde ses règles déterministes d'abord (escalade, FAQ, politesses, catégories, catalogue, recherche, infos entreprise). Seul le **dernier recours** change : `generateAIReply` est remplacé par `runAssistantTurn` (`assistant-turn-service.ts`). `generateAIReply` n'est pas modifié (utilisé par `follow-up-service`).

## Déroulé d'un tour
1. **Garde** (`customer-text-guard.ts`) : nettoyage (caractères invisibles, balises imitant nos délimiteurs, 1 000 caractères max) puis détection d'injection FR/EN. Message signalé = **jamais envoyé au modèle**, aucun crédit, escalade `requires_human_action` (le client reçoit l'accusé habituel).
2. **Un seul crédit par tour** (compréhension + rédaction = 2 appels). Disponibilité de l'IA vérifiée avant la réservation ; crédit remboursé si rien n'a pu être généré.
3. **Compréhension structurée** (`message-understanding.ts`) : petit modèle, schéma fixe, sortie **validée champ par champ** (valeurs inconnues → valeurs sûres ; textes courts alphanumériques seulement ; produit désigné par numéro). Si elle échoue, le tour continue avec le parseur déterministe.
4. **Faits depuis la base** : produits (prix, promo en cours, lien), infos entreprise. Le budget vient du parseur déterministe, jamais du modèle. **Le stock n'est jamais donné au modèle.**
5. **Rédaction** : prompt avec section FAITS et règles ; le message client est enveloppé `<customer_message>` comme donnée non fiable.
6. **Contrôle qualité en code** (`reply-quality.ts`) puis envoi. Si la réponse est écartée : réponse **déterministe depuis la base** (produits trouvés) ou « je vérifie » + escalade `unknown_information`.

## Intentions non traitées seules par l'assistant
réclamation → escalade `complaint` · demande d'un humain → `requires_human_action` · statut de commande → « je vérifie » + escalade (aucune consultation de commande côté assistant) · livraison / paiement → « je vérifie » (pas de règles par tenant en base) · infos entreprise non renseignées → « je vérifie ».

## Règles du contrôle qualité (toutes bloquantes)
prix ou promesse de gratuité non fondés (tout montant en FCFA doit venir de la base ou être le budget cité par le client) · quantité de stock · lien hors du site du commerçant · fuite des consignes · email ou numéro (≥ 8 chiffres) qui n'est pas celui du commerçant · nouvelle salutation alors que la conversation a commencé · voix de marque non respectée (tutoiement / vouvoiement, expression à éviter, trop d'emojis — étape 4a) · jargon et formules robotiques, phrase répétée · réponse vide ou trop longue (700 caractères / 12 lignes).

## Ce que le modèle ne peut PAS faire (principe 6)
Aucun outil, aucun droit d'écriture, aucune sortie envoyée sans contrôle. Les champs extraits (catégorie, couleur…) ne servent qu'à **chercher** (passés à `plainto_tsquery`, jamais recopiés dans une réponse).

## Limites et points ouverts
- **Faux positifs de la garde** : certains messages légitimes peuvent être signalés ; ils partent vers un humain (sûr, mais coûte du temps). À mesurer sur le jeu de conversations réelles anonymisées (livrable I). Jeu de test : `__fixtures__/c3-injection-messages.ts` (23 injections, 15 messages légitimes).
- **Contrôle qualité strict** : « gratuit » est refusé même s'il est vrai (ex. livraison offerte) tant que les règles de livraison ne sont pas en base ; à assouplir avec l'étape « règles du commerçant ».
- **Heures d'ouverture** : la présence d'horaires inventés n'est pas détectée par le code (seuls les prix, liens et coordonnées le sont) ; elles ne sont fournies que depuis la base et le prompt interdit d'inventer.
- **Sortie JSON de l'adaptateur Mistral** : `generateStructuredOutput` fait un `JSON.parse` strict ; si le modèle entoure le JSON de ```json, la compréhension échoue silencieusement (le tour continue sans elle). Correctif possible côté adaptateur (hors périmètre C3) : tolérer les blocs de code.
- **Anglais** : réponse en anglais si le client écrit en anglais. Pidgin : non traité (question ouverte).
- **Se présenter comme IA** : aucune règle ne l'interdit ni ne l'impose ; question ouverte pour Marc-well.
- Le contrôle qualité est calibré à la main : il faudra l'ajuster avec le jeu d'évaluation.

## Comment tester
- Unitaires : `npm test` — `customer-text-guard`, `reply-quality`, `message-understanding`, `assistant-turn-service` (fournisseur IA, crédits et base simulés), `conversation-orchestrator`.
- Scénario « modèle compromis » : `assistant-turn-service.test.ts` simule un modèle qui obéit à une instruction cachée (prix à 1 FCFA, lien étranger, fuite des consignes) et vérifie que rien n'est envoyé.
