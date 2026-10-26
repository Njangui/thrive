# C3 — Données envoyées à des API externes (principe 9 · loi n° 2024/017)

Registre à tenir à jour à chaque nouvelle fonction C3. **À faire valider par un juriste** (consentement, transferts hors du Cameroun) : ce document décrit les faits, il ne vaut pas avis juridique.

| Fonction | Destinataire | Données envoyées | Données NON envoyées | Étape |
|---|---|---|---|---|
| Recherche produit | aucun (base Supabase) | — | — | 1 |
| Compréhension du message | fournisseur IA choisi par le tenant (`ai_config` : Mistral, Claude ou OpenAI) | texte du message client (nettoyé, 1 000 caractères max), noms des produits récemment montrés | nom, téléphone, identifiant du client, historique de la conversation | 2 |
| Rédaction de la réponse | idem | texte du message client, nom de l'entreprise, secteur, ton/objectifs configurés, produits trouvés (nom, prix, catégorie, description courte, lien), horaires/adresse/contact du commerçant si demandés | stock, coût d'achat, marge, identité du client | 2 |
| Voix de marque dans la rédaction | idem | consignes de ton (tu/vous, emojis, expressions locales, expressions à éviter) ; **exemples de messages du commerçant UNIQUEMENT si `examples_consent = true`** (emails, numéros et liens retirés avant stockage) | profil de voix sans consentement | 4a |
| Messages prédéfinis (accueil, merci…) | aucun (texte local) | — | — | 4a |
| FAQ qui apprend (étape 4b) | aucun (base Supabase) | — | — | 4b |
| Livraison : zones, frais, retrait, paiement à la livraison (réponse déterministe) | aucun (base Supabase) | — | — | 6 |
| Livraison : questions complexes | fournisseur IA du tenant (chemin existant) | + zones, frais, délais, retrait renseignés par le commerçant (données commerciales) | stock, coût, identité du client | 6 |
| Commentaires publics : spam, compliments, prix, intention d'achat | aucun (règles locales, base Supabase) | — | — | 5 |
| Commentaires publics : autres questions | fournisseur IA du tenant, **par le chemin existant** (orchestrateur) | texte du commentaire (après garde anti-injection) | identité du commentateur | 5 |

## Conservation en base (non envoyé à un tiers)
| Donnée | Où | Durée | Condition |
|---|---|---|---|
| Prospect issu d'un commentaire (nom public + clé de plateforme ; jamais le texte ni de numéro) | `contacts` + `leads` | durée normale du CRM | création de prospects activée par le propriétaire (désactivée par défaut) |
| Question d'un client, nettoyée (200 caractères, sans identifiant de client ni de conversation) | `faq_question_log` | 30 jours (`purge_faq_question_log`, **à planifier**) | apprentissage activé par le propriétaire (désactivé par défaut) |

## Remarques
- Un message client peut contenir des données personnelles écrites par le client lui-même (nom, numéro, adresse). Elles partent au fournisseur IA avec le texte. Pas de pseudonymisation à ce stade : **à décider** (étape « données et légal »).
- Les messages bloqués par la garde anti-injection ne sont envoyés à personne.
- Le journal d'audit `ASSISTANT_INJECTION_BLOCKED` / `ASSISTANT_REPLY_REJECTED` ne contient que les noms des signaux ou règles déclenchés, jamais le texte du client.
- Aucun usage de ces données pour entraîner un modèle (opt-in par tenant requis, non implémenté).
