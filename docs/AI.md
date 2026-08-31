# IA

Le produit **n'est pas** un chatbot IA — c'est une plateforme dont l'IA
n'est qu'un composant, en dernier recours (section 20/45/67 doc produit).

## Ordre de résolution (jamais l'inverse)

```
1. données structurées (business data)
2. FAQ
3. règles / mots-clés (product discovery)
4. catalogue (recherche produit)
5. business data (horaires/adresse/contact)
6. IA — seulement si rien au-dessus n'a répondu
```

Voir `application/services/conversation-orchestrator.ts` et ses tests.

## Le produit fonctionne sans IA (section 67)

`ai_config.enabled = false` par défaut à la création d'un tenant
(`onboarding-service.ts`). Catalogue, landing, FAQ, CRM, finance,
marketing fonctionnent sans qu'aucune clé IA ne soit configurée. Si l'IA
est indisponible/désactivée au moment où elle serait nécessaire,
l'orchestrateur **escalade vers un humain** plutôt que de laisser la
conversation sans réponse (`handoffReason: "ai_unavailable"`).

## AI Gateway

```
Service applicatif -> AIProvider (port) -> Adapter concret
```

`infrastructure/providers/ai/` contient les adapters Mistral, Claude,
OpenAI — tous implémentent la même interface `AIProvider`
(`generateText`, `generateStructuredOutput`, `classify`). Le modèle
utilisé vient toujours de `ai_config.model` (par tenant), jamais codé en
dur.

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
