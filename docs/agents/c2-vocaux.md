# C2 — Commandes vocales (livrable F)

Flux unique : **audio → `SpeechPort` (C3) → texte → exactement le même chemin qu'un message tapé** (acteur résolu, rôle relu, moteur de règles de C1, cartes d'approbation). Aucun chemin spécial n'existe pour la voix.

## Où ça passe

| Canal | Entrée | Écho | Notes |
|---|---|---|---|
| Telegram (privé, membre lié) | `voice` / `audio` | « 🎤 J'ai compris : « … » » | contrôles durée/taille sur les métadonnées Telegram **avant** téléchargement |
| WhatsApp (membre lié) | pièce jointe `audio` Zernio | idem | média relu via `downloadRemoteMedia` (liste blanche d'hôtes : `media.zernio.com`, `*.supabase.co`) |
| Dashboard | bouton 🎤 → `POST /api/dashboard/assistant/transcribe` | le texte arrive dans la zone de saisie | relu/corrigé avant envoi ; si la transcription est indisponible, repli sur l'ancien comportement (vocal joint) |

Un vocal d'un numéro/compte **non lié** n'est ni téléchargé ni transcrit (Telegram : rendu au bot plateforme ; WhatsApp mode partagé : pipeline client ; mode dédié : refus).

## Code

- `src/domain/ports/speech-port.ts` — `SpeechPort.transcribe`, `SpeechUnavailableError`. **Miroir provisoire** du port de C3.
- `src/application/voice/speech-registry.ts` — `registerSpeechPort()` (C3 branche son adaptateur) ; défaut = indisponible (message clair à l'utilisateur).
- `src/application/voice/voice-policy.ts` — règles pures : signature binaire (ogg/webm/m4a/mp3), 2 min / 4 Mo max, normalisation du texte, détection de PIN dicté.
- `src/application/services/voice-command-service.ts` — `transcribeVoice()` : contrôles → limite de débit (`voice_transcription`, 10/min/utilisateur) → port → nettoyage → usage → PIN dicté.

## Modèle de menace

- **Un vocal ne valide jamais rien.** Les approbations passent par boutons Telegram / tableau de bord ; le texte transcrit n'a aucun chemin vers `approve`. « Oui je valide » dit à voix haute = simple donnée pour l'agent. Testé sur Telegram et WhatsApp (`decideApproval` jamais appelé).
- **PIN dicté** : transcription composée uniquement de chiffres / mots-chiffres, ou « code/pin … » + chiffres → **non transmise à l'agent, non enregistrée** ; sur Telegram le vocal est supprimé ; l'utilisateur est averti. Limite : l'audio a déjà été envoyé au fournisseur de transcription — l'aide du bot dit « Ne dictez jamais votre code PIN ».
- **Rôle** : la voix n'élargit aucun droit. Un `employee` qui dicte une action de rôle supérieur est refusé par les outils (garde de rôle de l'étape 6).
- **Injection** : la transcription est la parole de l'utilisateur authentifié, au même statut que du texte ; un vocal rejoué/transféré par un tiers depuis un numéro non lié n'atteint pas l'agent.
- **Format** : type déduit de la signature binaire, jamais du MIME annoncé ; HTML/exécutable refusés avant tout envoi externe.
- **Coût** : plafond de durée, de taille, limite de débit. Durée inconnue sur WhatsApp → seul le plafond de taille s'applique (≈ 0,003 $/min d'après le brief, à vérifier).
- **Erreurs** : détail du fournisseur (clés, messages) jamais renvoyé à l'utilisateur.

## Données envoyées à l'API externe (loi 2024/017 — à faire valider)

À `SpeechPort.transcribe` (fournisseur choisi par C3, Voxtral prévu au brief) : **les octets audio et le type MIME**, rien d'autre (pas d'identité, pas de nom de fichier, pas de numéro). Le fournisseur est hors du Cameroun → transfert à encadrer + consentement explicite du tenant/utilisateur. Côté Flexco : **l'audio n'est pas conservé** (mémoire uniquement, Telegram/WhatsApp/dashboard dictée) ; la transcription est stockée comme n'importe quel message du chat (fil `assistant_messages`). Journal d'usage : métadonnées seulement (organisation, utilisateur, canal, octets, durée, nb de caractères), **jamais le contenu**.

## Intégration C1 / C3

- `VoiceDeps.onUsage` : point d'accroche du registre d'usage de C1 (aujourd'hui : `console.info` sans contenu).
- C3 : remplacer le miroir `speech-port.ts` par son contrat ; appeler `registerSpeechPort(adapter)` au démarrage. Tant que ce n'est pas fait, tous les canaux répondent « La transcription des vocaux n'est pas disponible pour le moment. Écrivez votre demande. » (testé).
- À vérifier avec C3 : langues (fr/en, mélange local), format WhatsApp réel (`ogg/opus` attendu ; l'AMR serait refusé « format audio non reconnu »), URL média Zernio réellement sur `media.zernio.com`.

## Tester

`npx vitest run src/application/voice src/application/services/voice-command-service.test.ts src/application/services/telegram-backoffice-service.test.ts src/application/services/whatsapp-backoffice-service.test.ts src/app/api/dashboard/assistant/transcribe`.
Test réel (une fois C3 branché) : envoyer un vocal de 5 s « combien de savons en stock ? » depuis un Telegram lié, puis un vocal « supprime le produit X » depuis un compte employee (doit être refusé), puis un vocal disant seulement un code à 6 chiffres (doit être refusé et supprimé).

## Limites

- Pas de réponses vocales (synthèse hors périmètre C2).
- Pas de seuil de confiance de transcription (le port n'en expose pas) : l'écho + la carte d'approbation (montants calculés par le code) sont les garde-fous contre une mauvaise compréhension.
- Vocal multi-minutes et vocaux transférés/groupes : non gérés.
