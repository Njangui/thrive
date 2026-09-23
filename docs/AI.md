# IA

Le produit **n'est pas** un chatbot IA — c'est une plateforme dont l'IA
n'est qu'un composant, en dernier recours (section 20/45/67 doc produit).

## Ordre de résolution (jamais l'inverse)

```
0. escalade explicite (plainte, remboursement) -> humain, aucune auto-réponse
1. FAQ (jamais d'appel LLM si une correspondance existe)
2. politesses (bonjour / merci / au revoir) -> réponse fixe, jamais l'IA
3. PRODUCT_DISCOVERY (« présentez-moi vos biens/plats/prestations… »,
   vocabulaire adapté au SECTEUR du tenant — voir message-intents.ts)
4. PRODUCT_QUERY / SERVICE_QUERY (recherche par nom, en parallèle)
5. business data (horaires/adresse/contact)
6. IA — seulement si rien au-dessus n'a répondu, et si l'offre l'autorise
```

Voir `application/services/conversation-orchestrator.ts` et ses tests.
Chaque étape déterministe (FAQ, catalogue, infos) est protégée
individuellement (`safeStep`) : une erreur sur une étape ne fait jamais
perdre les suivantes, ni le message du client.

## Lot P — l'IA est active PAR DÉFAUT, sans activation manuelle

Avant ce lot, une nouvelle conversation démarrait avec `handoff_status`
existant côté DB (`ai` par défaut au niveau schéma), mais un premier
message sans correspondance FAQ/catalogue/infos ET une IA non activée
(`ai_config.enabled = false`, valeur par défaut à l'onboarding)
faisaient passer `handoff_status` à `pending_human` — et là restaient
bloqués : plus aucune réponse, même déterministe, jusqu'à un clic manuel
sur « Rendre à l'IA ». Un commerçant devait répéter cette opération sur
chaque conversation.

Trois mécanismes corrigent ça (voir `handoff-service.ts`) :

- **`getAutoReplyMode`** distingue `pending_human` À CAUSE d'une IA
  indisponible (`ai_unavailable`/`semi_automatic`) — où FAQ, catalogue et
  infos restent servis — d'un `pending_human` pour une VRAIE raison
  humaine (plainte, remboursement) ou d'une prise en charge `human`, où
  rien ne part automatiquement.
- **`applyAutoResume`**, appelé à CHAQUE message entrant
  (`conversation-service.ts::handleInboundMessage`) : une conversation
  `resolved` se rouvre automatiquement ; une conversation `human` rend la
  main à l'IA après la pause réglée sur `/dashboard/ai`
  (`ai_config.human_pause_minutes`, défaut 15 min, 0 = jamais de pause —
  voir `messaging-settings-service.ts` et la migration `0068`).
- **`inbound-auto-reply-service.ts`** garantit qu'AUCUN message client ne
  reste sans réaction : un accusé de réception poli part dans tous les
  cas où rien d'automatique ne peut répondre (IA indisponible, offre
  semi-automatique, plainte, pièce jointe seule, erreur technique de
  routage), au plus une fois par fenêtre de 30 minutes, ET l'équipe est
  notifiée (`notifyUnansweredInboundMessage`). Un envoi qui échoue
  (canal déconnecté, fenêtre WhatsApp fermée) prévient aussi l'équipe
  (`notifyAutoReplyFailed`) plutôt que d'échouer en silence.

Le fil de conversation (`/dashboard/conversations/[id]`) affiche l'état
courant (IA active / en pause jusqu'à HH:mm / en attente d'un humain —
motif / clôturée) et propose un bouton « Prendre la main » pour mettre
l'IA en pause sans avoir à écrire tout de suite un message.

## Lot P — vocabulaire sectoriel et politesses

`message-intents.ts` reconnaît, sans aucun appel IA :
- les politesses (bonjour/bonsoir, merci, au revoir — y compris via
  emoji) ;
- une demande de présentation du catalogue, dans le vocabulaire du
  secteur du tenant (`retail`, `restaurant`, `beauty`,
  `professional_services`, `real_estate` — voir
  `application/config/storefront-blueprint.ts`) : « vos biens », « la
  carte », « vos prestations » déclenchent tous PRODUCT_DISCOVERY, pas
  seulement « produits »/« catalogue ». Avant ce lot, un tenant
  immobilier dont le client demandait « présentez-moi vos propriétés »
  ne recevait AUCUNE réponse déterministe (le mot « propriétés »
  n'existait dans aucune liste de mots-clés), et tombait directement sur
  l'IA — qui, non activée dans ce test réel, ne répondait pas non plus.

## Lot P — aucun message client sans réaction, tous canaux

- **Zernio (WhatsApp/Messenger/Instagram)** : un message SANS texte
  (vocal, photo, document) n'est plus ignoré par le mapper — voir
  `infrastructure/providers/messaging/zernio/mapper.ts::extractZernioAttachment`.
  Un message reçu depuis un groupe WhatsApp connecté (diffusion, pas une
  conversation client) ne déclenche plus ni contact, ni conversation, ni
  réponse automatique — voir `whatsapp-group-service.ts::isKnownWhatsAppGroupConversation`.
- **Telegram** : un type de contenu non géré par le téléchargement de
  pièce jointe (sticker, sondage, position, note vocale ronde…) n'est
  plus perdu — le mapper accepte désormais tout message d'un chat privé,
  avec un texte de repli si nécessaire. Un téléchargement qui échoue
  (fichier trop lourd, erreur réseau) ne fait plus échouer tout le
  traitement de l'update : le message est conservé, sans pièce jointe.

## Le produit fonctionne sans IA (section 67)

`ai_config.enabled = false` par défaut à la création d'un tenant
(`onboarding-service.ts`). Catalogue, landing, FAQ, CRM, finance,
marketing fonctionnent sans qu'aucune clé IA ne soit configurée. Si l'IA
est indisponible/désactivée au moment où elle serait nécessaire,
l'orchestrateur **escalade vers un humain** plutôt que d'inventer une
réponse (`handoffReason: "ai_unavailable"`) — mais FAQ, catalogue et
infos entreprise continuent de répondre normalement pour les messages
suivants (voir Lot P ci-dessus, `getAutoReplyMode`), et le client reçoit
un accusé de réception plutôt qu'un silence total.

## AI Gateway

```
Service applicatif -> AIProvider (port) -> Adapter concret
```

`infrastructure/providers/ai/` contient les adapters Mistral, Claude,
OpenAI — tous implémentent la même interface `AIProvider`
(`generateText`, `generateStructuredOutput`, `classify`). Le modèle
utilisé vient de `ai_config.model` (par tenant) — configurable depuis
`/dashboard/ai` (Lot L), qui n'expose jamais le nom de modèle brut au
commerçant (vocabulaire non technique, section 7/54 doc produit) : au
choix d'un provider correspond un modèle par défaut recommandé
(`DEFAULT_MODEL_BY_PROVIDER`, `infrastructure/providers/registry.ts`),
y compris pour le provider de secours (`fallback_provider`) — jamais
codé en dur ailleurs dans le code.

## Fallback contrôlé et loggé

`ai-response-service.ts` : si le provider primaire échoue et qu'un
`fallback_provider` est configuré, on bascule dessus — et on logge
l'événement dans `audit_logs` (action `AI_PROVIDER_FALLBACK`) pour rester
observable.

## Contexte envoyé au modèle (jamais un dump de la base)

`tenant-ai-context.ts` construit le system prompt à partir de champs
explicitement sélectionnés (nom entreprise, secteur, ton, langue,
objectifs) — jamais un `SELECT *` concaténé. Le prompt système interdit
explicitement au modèle d'inventer un prix, un stock ou une action non
effectuée.
