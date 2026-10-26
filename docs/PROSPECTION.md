# Flexco sur Flexco et prospection WhatsApp

## 1. Flexco comme entreprise de sa propre plateforme
- Créez l'entreprise Flexco comme n'importe quel client, puis renseignez son identifiant dans `FLEXCO_PLATFORM_ORG_ID`.
- Tableau de bord → Versions du site → « Contenu Flexco (offres actuelles) » : génère la FAQ et l'accueil (site libre) à partir de la table `plans`. Rien n'est publié : relire l'aperçu, puis publier. Relancer l'action après un changement de prix.
- L'assistant de cette entreprise reçoit des consignes de persona commerciale (`PLATFORM_SALES_RULES`) : messages WhatsApp, messages privés et commentaires passent par le même orchestrateur que les autres clients (FAQ → infos → catalogue → IA en dernier).

## 2. Prospection WhatsApp
1. Connecter le numéro WhatsApp de Flexco (Zernio).
2. `/dashboard/prospection` → « Soumettre les modèles » : deux modèles MARKETING (premier message, relance) partent en revue chez Meta. **Rien ne peut être envoyé tant que le premier message n'est pas APPROVED** (statut mis à jour par webhook ou lors de la resynchronisation).
3. Importer un CSV (Excel : Enregistrer sous → CSV UTF-8). Colonnes libres ; téléphone obligatoire ; nom, entreprise, secteur, ville, email reconnus. Numéros normalisés (+237 par défaut), doublons et numéros déjà désinscrits écartés.
4. Lire l'aperçu (texte exact), déclarer la base de contact, valider. Via le chat : `prospecting.approve` exige validation + PIN.
5. Appeler `/api/cron/process-prospecting` toutes les 10–15 min (même `CRON_SECRET` que les autres crons).

### Garde-fous (testés)
Validation liée à l'empreinte (liste ou règle modifiée ⇒ suspension) · plafond quotidien 1–200 (jour local) · plage horaire, jamais le dimanche · 1 relance maximum, 72 h minimum, seulement sans réponse · STOP ou refus ⇒ désinscription définitive, toutes campagnes · 3 échecs d'affilée ⇒ suspension + notification · contenu du CSV traité comme donnée.

### Limites à connaître
- Meta exige un consentement préalable pour écrire à un numéro. Une liste sans accord expose le numéro à des signalements et à un blocage ; l'outil force à déclarer la base de contact mais ne peut pas la vérifier.
- Le format exact des événements Zernio/Meta (statut de modèle, échec) n'a pas été vérifié en conditions réelles : à valider en staging avec 1–2 numéros de test avant toute campagne.
- Excel `.xlsx` : non lu directement (exporter en CSV).
