# C3 — Règles de livraison du tenant (étape 6 · point G du brief)

Branche : `agents/c3-assistant-client` · Migration : `0145_c3_delivery_rules.sql` · Prérequis : étapes 1, 2, 4a, 4b et 5.

## Constat avant cette étape
Aucune donnée de livraison structurée n'existait (la barre d'annonce de la vitrine n'est qu'un texte libre). Toute question « livrez-vous à X ? » finissait en « je vérifie » + escalade, et le contrôle qualité refusait « gratuit » même quand c'était vrai.

## Ce que ça fait
Les zones, frais, seuils de gratuité, délais, retrait et paiement à la livraison sont **lus en base comme les prix** : jamais figés dans un gabarit, jamais inventés par un modèle (principe 3).
1. **Réponse déterministe** (règles d'abord, avant l'IA) : « Vous livrez à Douala ? » → *« Oui, nous livrons à Douala : frais de livraison : 1 500 FCFA, délai : 24 à 48 h. »* Zone reconnue par nom ou alias (sans accents ni casse, mot entier, la plus précise d'abord). Zone inconnue → liste des zones servies + « pour une autre zone, écrivez-nous et nous vérifions » (on ne prétend jamais savoir pour la zone demandée). S'applique aussi aux **commentaires publics**.
2. **Jamais de oui/non sur ce qui n'est pas renseigné** : retrait et paiement à la livraison valent `NULL` = « non renseigné » ; une question mixte reçoit une réponse **complète ou aucune** (la chaîne continue : IA avec faits, ou « je vérifie »).
3. **Faits pour le modèle** (questions complexes) : zones, frais, délais, retrait, paiement à la livraison. Les frais et seuils renseignés deviennent des montants citables ; **un frais inventé est refusé** par le contrôle qualité. « Gratuit » n'est accepté que si une zone est réellement gratuite ou gratuite dès un seuil (et le seuil cité doit être le bon).
4. **Variables de FAQ** : `{delivery:identifiant-zone}` (frais + délai actuels) et `{delivery_zones}` (liste). Le tarif change → la FAQ suit sans être réécrite ; zone supprimée ou désactivée → la FAQ n'est pas utilisée (jamais périmée).
5. **Voix de marque** : six nouveaux messages (`delivery_*`), tu/vous, surchargeables.
6. **Saisie validée** : montants positifs, zone gratuite sans frais (aussi imposé en base), identifiant dérivé du nom, 10 alias, délai ≤ 80 caractères. Une saisie invalide est refusée, jamais corrigée.

## Faux positifs corrigés en route
« Merci pour la livraison », « Ma livraison est arrivée », « Quand arrive mon colis ? » (suivi de **sa** commande) ne sont **pas** des questions sur les zones : ils ne déclenchent plus de liste de zones.

## Ce qui n'est PAS dans cette étape
- **Moyens de paiement** (Orange Money, MTN MoMo, carte…) : non modélisés ; une question de paiement seule reste « je vérifie ». Seul « paiement à la livraison » est géré.
- **Pas d'interface** : zones et réglages sont des services protégés (propriétaire / administrateur) sans écran (`saveDeliveryZone`, `removeDeliveryZone`, `saveDeliverySettings`, `listDeliveryZones`) ; à brancher (dashboard ou outil de chat C2).
- **Frais calculés à la commande** (poids, distance, adresse) : hors périmètre ; une zone sans frais renseigné répond « frais communiqués à la commande ».
- **Tunnel de commande** : les frais renseignés ici ne sont pas encore appliqués au calcul du total (périmètre commande/paiement, pas C3) ; **la réponse de l'assistant et le montant facturé pourraient diverger** tant que les deux ne partagent pas la même source. À traiter avec C2/C4 avant d'activer largement.
- Relance sans mot de livraison (« Et à Yaoundé ? » après une réponse) : pas de réponse déterministe ; l'étape suivante a le contexte.
- Détection par mots-clés FR/EN : pas de pidgin ni d'argot.

## Choix à valider
- « Gratuite dès X » compte comme « gratuit » fondé pour le contrôle qualité (le seuil cité doit être exact).
- Une zone sans frais ni gratuité renseignés : « frais communiqués à la commande ».
- Les zones sont lisibles par tous les membres (le prix de livraison n'est pas confidentiel) ; seules les écritures sont réservées propriétaire / administrateur.

## Données et légal
Données commerciales du commerçant, aucune donnée personnelle de client ; **rien n'est envoyé à une API externe** par la réponse déterministe. Pour les questions complexes, les règles renseignées sont ajoutées aux faits du prompt (voir `c3-donnees-externes.md`).

## Comment tester
- Unitaires : `npm test` (`delivery-rules`, `delivery-rules-service`, `conversation-orchestrator`, `assistant-turn-service`, `reply-quality`, `faq-learning-service`).
- SQL réel : `npm run test:integration` avec `SUPABASE_TEST_*` (`tests/integration/c3-delivery-rules.test.ts`).
- Déploiement : appliquer `0145` ; sans elle, `loadDeliveryRules` retombe sur « aucune règle » et l'assistant se comporte comme avant.
