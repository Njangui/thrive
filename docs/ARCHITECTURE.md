# Architecture

## Principe : hexagonale (ports & adapters)

```
domain/            Entités, ports (interfaces). ZÉRO import de Next.js,
                    Supabase ou Zernio. C'est le cœur métier, testable en
                    isolation (voir les tests de conversation-orchestrator).

application/        Services qui orchestrent le domaine. Dépendent des
                    PORTS du domaine, jamais des adapters concrets
                    directement (ex: ai-response-service appelle
                    AIProvider, jamais MistralAdapter).

infrastructure/     Implémentations concrètes des ports (ZernioAdapter,
                    MistralAdapter, SupabaseClient...). Seule couche qui
                    parle à des services externes.

app/                Next.js. Route handlers, Server Components, Server
                    Actions — la couche la plus fine, délègue tout à
                    application/.
```

Règle absolue (jamais transgressée dans ce code) : un fichier sous
`domain/` ne doit importer ni Next.js, ni `@supabase/*`, ni de SDK
provider. Si Zernio ou le provider IA change demain, seule
`infrastructure/providers/*` est réécrite.

## Provider Registry

`infrastructure/providers/registry.ts` est le point d'entrée unique pour
obtenir un adapter concret :

```ts
const messaging = await getMessagingProvider(organizationId); // -> ZernioAdapter aujourd'hui
const { primary, fallback } = await getAIProvider(organizationId); // -> Mistral + fallback configuré
const social = await getSocialPublishingProvider(organizationId); // -> ZernioSocialAdapter
```

Aucun service applicatif n'importe un adapter directement — toujours via
le registry, qui lit `provider_connections` pour savoir quel adapter
construire.

## Le routeur (ConversationOrchestrator)

`application/services/conversation-orchestrator.ts` est le point d'entrée
unique entre un message WhatsApp normalisé et une réponse. Ordre de
résolution imposé (jamais inversé) :

```
1. Escalade explicite (plainte/remboursement)  -> HUMAN, jamais l'IA
2. FAQ (mots-clés)                              -> pas d'IA
3. PRODUCT_DISCOVERY (mots-clés génériques)     -> pas d'IA
4. PRODUCT_QUERY (recherche par mot du message) -> pas d'IA
5. BUSINESS_INFO (horaires/adresse/contact)     -> pas d'IA
6. IA (dernier recours)                         -> si indisponible, escalade
```

Voir les tests dans `conversation-orchestrator.test.ts` qui vérifient
explicitement que l'IA n'est jamais appelée quand une étape précédente a
répondu.

## Pipeline webhook

```
Zernio (HTTP)
  -> vérification signature (HMAC-SHA256, header X-Zernio-Signature)
  -> déduplication (webhook_events, clé = payload.id)
  -> normalisation (mapper.ts : format Zernio -> DomainEvent)
  -> conversation-service (upsert contact/conversation/message)
  -> conversation-orchestrator (décide la réponse)
  -> messaging provider (envoi de la réponse)
```

## Modules activables par tenant

`tenant_modules` + `application/config/modules.ts` : un module
(`catalog`, `whatsapp`, `finance`, `marketing`...) doit être explicitement
activé pour un tenant. `isModuleEnabled(orgId, module)` doit être vérifié
avant toute route/action sensible à un module.

## Sécurité applicative (double barrière)

1. **RLS** (Postgres) — la barrière réelle, ne peut jamais être contournée
   par un bug applicatif.
2. **`requireMembership(orgId, roles)`** (`application/services/auth-service.ts`)
   — vérification explicite en tête de toute route/Server Action admin.
   N'importe pas RLS, s'ajoute à elle.

Le `service_role` Supabase (bypass RLS) n'est utilisé que pour les
webhooks et l'onboarding (avant qu'un membership existe) — et toujours
avec un filtre explicite par `organization_id` dans le code.
