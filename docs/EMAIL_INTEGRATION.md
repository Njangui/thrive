# Intégration Email — Resend (Lot L)

Aucun fournisseur d'email n'existait dans ce projet avant ce lot (vérifié
explicitement — voir `00_CONVENTIONS_COMMUNES_V3.md`). Ce document liste
ce qui est **confirmé** sur `resend.com/docs` (consulté le 31 août 2026),
avec la même rigueur que `docs/ZERNIO_INTEGRATION.md` : rien n'est deviné.

## Pourquoi Resend

API simple (un seul endpoint pour l'usage de ce lot), authentification
`Bearer` standard, free tier suffisant pour un MVP. Choix explicite du
cahier ("ex: Resend"), vérifié plutôt qu'accepté aveuglément.

## Confirmé

- Base URL : `https://api.resend.com`.
- Auth : header `Authorization: Bearer <clé>`.
- Envoi : `POST /emails`, payload `{ from, to: string[], subject, html?, text? }`.
- Réponse succès : `{ "id": "<uuid>" }` uniquement.
- Réponse erreur : corps JSON `{ statusCode, name, message }`.

## Limitation opérationnelle CONFIRMÉE — critique pour ce lot

Tant qu'**aucun domaine n'est vérifié** dans le compte Resend
(resend.com/domains), l'adresse d'expédition `*@resend.dev` ne peut
envoyer que vers l'adresse email du **titulaire du compte Resend
lui-même** — jamais vers un destinataire arbitraire. Concrètement : sans
domaine vérifié, une vraie invitation envoyée à un collègue échouera côté
Resend (403), même avec une clé API valide.

### Comment ce lot absorbe cette contrainte (cahier V3 : "livrez quelque
chose qui marche de bout en bout, pas un renvoi vers une limitation")

`team-service.ts::inviteMember` ne fait JAMAIS dépendre la création de
l'invitation de la réussite de l'email :

1. L'invitation (`team_invitations`, avec son lien `/invite/accept?token=...`)
   est TOUJOURS créée en base, quoi qu'il arrive côté email.
2. L'envoi d'email est tenté en best-effort ; son échec (clé absente,
   domaine non vérifié, quota dépassé...) est capturé et **jamais
   silencieux** : `InviteMemberResult.emailDelivered` / `.emailError`
   remontent jusqu'à l'écran `/dashboard/team`, qui affiche alors le lien
   d'invitation en clair, copiable, pour un partage manuel (WhatsApp, SMS,
   en personne...).

Résultat : la fonctionnalité "inviter quelqu'un" fonctionne réellement de
bout en bout dès aujourd'hui, indépendamment de la configuration Resend —
l'email est une commodité, jamais un point de blocage.

## Avant la mise en production

1. Créer un compte Resend, générer une clé API → `RESEND_API_KEY`.
2. Vérifier un domaine réel (resend.com/domains) appartenant à
   l'opérateur de la plateforme (pas un domaine tenant individuel — un
   seul provider email plateforme, voir `registry.ts::getEmailProvider`,
   même raisonnement que Storage/Payment/Domain).
3. Mettre à jour `EMAIL_FROM_ADDRESS` avec une adresse sur ce domaine
   vérifié (ex : `SME-OS <invitations@sme-os.app>`).
4. Sans ces 3 étapes, `getEmailProvider()` retombe sur
   `ConsoleLogEmailAdapter` (si `RESEND_API_KEY` absente) — l'invitation
   reste fonctionnelle via le lien, l'email est seulement loggé.

## Ce qui reste À CONFIRMER

- Comportement exact des webhooks Resend (delivered/bounced/complained) —
  non utilisés par ce lot (aucun besoin de suivi de livraison pour une
  invitation), à vérifier si un futur lot en a besoin.
- Limites de taux exactes du plan gratuit — non critiques ici (volume
  d'invitations d'équipe très faible par nature).
