# C3 — Commentaires publics (étape 5 · livrable G)

Branche : `agents/c3-assistant-client` · Migration : `0144_c3_comment_assistant.sql` · Prérequis : étapes 1, 2, 4a et 4b.

## Constat avant cette étape
`processCommentAutoReply` envoyait chaque commentaire à l'orchestrateur comme un message privé : réponses longues (listes de produits) dans un fil public, aucun lien avec la publication, aucune détection d'intention, aucune modération, plaintes sans réponse. **Ses 18 tests historiques passent inchangés** : tout le nouveau comportement est isolé et retombe sur « comportement d'avant » en cas d'erreur de lecture des réglages.

## Ce que ça fait
Règles d'abord, IA ensuite (principe 2) : le code classe le commentaire **avant** tout appel à l'IA.
1. **Spam** : formulations qu'aucun client réel n'écrit (loterie, forex/crypto, paris, gains faciles, faux suivis, « cliquez ici »…) = spam à elles seules ; deux signaux faibles dont un lien ou une sollicitation (« dm me », « écris-moi sur Telegram ») = spam ; un lien seul ou une rafale d'emojis/majuscules = **suspect**. Spam et suspect : **jamais de réponse** (ni IA, ni crédit). Le spam n'est **masqué** que si le commerçant l'a activé, que le réseau le permet (**Facebook, Instagram, Threads**, confirmé ; TikTok non) et que le signal est fort. Un suspect n'est jamais masqué.
2. **Compliments** (« Magnifique ! ») : ignorés par défaut (aucun crédit dépensé) ; remerciés dans la voix du commerçant s'il l'active.
3. **Produit via la publication** : `social_posts.product_id` → produit **actif** ; le prix vient de la base (jamais du commentaire ni d'un modèle) ; prix barré seulement si la promotion est en cours. « Quel est le prix ? » sous la publication d'un sac → *« Le Sac cuir est à 15 000 FCFA. Écrivez-nous en message privé pour commander. »* — sans orchestrateur, sans IA.
4. **Intention d'achat explicite** (« je le prends », « comment commander », « appelez-moi »…, négations exclues) → réponse courte + invitation en message privé ; **prospect créé uniquement si le commerçant l'a activé** : contact minimal (nom public + clé de plateforme, **jamais le texte du commentaire ni un numéro**), un seul contact par commentateur et par entreprise, lead ouvert réutilisé s'il existe. Une simple question de prix ne crée jamais de prospect.
5. **Réponse publique courte** : au-delà de 320 caractères (liste de produits, détails), l'orchestrateur n'est plus publié tel quel : invitation en message privé.
6. **Plaintes / remboursements** : escalade comme avant ; **accusé public court** (« Nous sommes désolés… écrivez-nous en message privé ») seulement si activé. Un échec d'envoi de l'accusé n'empêche jamais l'escalade. Aucune autre escalade (information inconnue, injection) ne produit de réponse publique.
7. **Injection** : un commentaire est une donnée non fiable ; il passe par la même garde que les messages (jamais envoyé au modèle s'il ressemble à une instruction).

Toutes les phrases viennent de la bibliothèque de messages (huit nouvelles clés `comment_*`, tu/vous, niveau d'emojis, surcharges du commerçant).

## Réglages (`comment_assistant_settings`, un par entreprise)
| Réglage | Défaut | Effet |
|---|---|---|
| produit de la publication | **activé** | répond au prix depuis la base |
| invitation en message privé | **activé** | termine les réponses ; remplace les réponses trop longues |
| créer des prospects | désactivé | contact + lead sur intention d'achat explicite |
| masquer le spam | désactivé | Facebook / Instagram / Threads, signal fort seulement |
| accusé public aux plaintes | désactivé | excuse courte + message privé |
| remercier les compliments | désactivé | sinon ignorés |

## Changements de comportement par rapport à avant (à connaître)
- Le **spam** et les commentaires **suspects** ne reçoivent plus de réponse (avant : routés vers l'IA).
- Les **compliments** ne reçoivent plus de réponse par défaut (avant : routés vers l'IA, crédit dépensé).
- Les réponses **longues** deviennent une invitation en message privé (avant : texte tronqué à 900 caractères).
- Les commentaires de prix sous une publication avec produit sont répondus par le code.

## Données et légal (loi n° 2024/017)
Un prospect issu d'un commentaire est une donnée personnelle (nom public + identifiant de plateforme) : **opt-in par entreprise**, minimal, sans le texte. **À faire valider par un juriste** : base légale du contact créé depuis un commentaire public. Le texte d'un commentaire n'est envoyé à un fournisseur IA que par le chemin existant (orchestrateur) et après la garde anti-injection.

## Ce qui n'est PAS dans cette étape
- **Pas de message privé automatique** : l'API Zernio de réponse privée à un commentaire n'est pas confirmée (« à vérifier » : script `scripts/verify-zernio-capabilities.ts`) ; on invite seulement, en public.
- **Pas de règles de livraison du tenant** (point G du brief) : « livrez-vous à X ? » sous une publication reste « je vérifie » + escalade. C'est l'étape suivante : table de zones (frais, délais, retrait) lue comme les prix.
- **Pas d'interface** : réglages et filtre « spam » sont des services (`getCommentSettings`, `saveCommentSettings`) sans écran ; à brancher (dashboard Canaux ou outil de chat C2).
- **Services (rendez-vous) non liés à la publication** : seul `product_id` est utilisé, pas `service_id`.
- **Numéro partagé en commentaire** : détecté comme demande de contact, mais jamais enregistré (normalisation E.164 et consentement à prévoir).
- Détection par mots-clés (FR/EN, quelques tournures locales) : pidgin et argot non couverts ; à ajuster sur de vrais commentaires (livrable I).

## Comment tester
- Unitaires : `npm test` (`comment-assistant`, `comment-moderation-service`, `comment-auto-reply-service` historique + `.moderation`, `message-library`).
- SQL réel : `npm run test:integration` avec `SUPABASE_TEST_*` (`tests/integration/c3-comment-assistant.test.ts`).
- Déploiement : appliquer `0144` ; sans elle, la lecture des réglages échoue et le service retombe sur le comportement d'avant.
