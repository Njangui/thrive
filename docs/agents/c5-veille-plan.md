# C5 — Plan « Veille marché » — constat, plan et points légaux à valider (avant tout code)

Sources : documentation Zernio « Ad Library » (docs.zernio.com/platforms/meta-ads/ad-library) et référence `GET /v1/ads/library`, consultées le 09/10/2026. Ce qui n'y figure pas est marqué « à vérifier ». Je ne suis pas juriste : les points légaux sont à faire valider.

## 1. Constat qui change le plan : l'archive publique des pubs Meta est quasi aveugle pour le Cameroun
La documentation Zernio dit que, hors publicités politiques / sociétales, une annonce n'est dans l'archive **que si elle a été diffusée dans l'UE ou au Royaume-Uni dans la dernière année** ; un annonceur commercial qui ne vise qu'un autre marché est **invisible, quel que soit le paramètre `countries`**.
→ Les pubs d'un concurrent camerounais qui cible Douala ou Yaoundé **n'apparaîtront pas**. Brancher « Zernio Ad Library » comme cœur de la veille donnerait un écran presque toujours vide, ce qui serait trompeur.
Elle reste utile dans un cas étroit : des concurrents qui ciblent aussi la diaspora en Europe (importateurs, mode, restauration). Autres faits : aucune connexion de compte n'est requise pour Meta (quota Meta **partagé** entre tous les clients Zernio : `429` = attendre une minute) ; les conditions de Meta n'autorisent le téléchargement d'un visuel que pour **analyse** (jamais pour le republier ou le réutiliser).

## 2. Ce qu'on peut faire de fiable et de légitime (par ordre de valeur)
| # | Signal | Source | Données personnelles ? | Coût |
|---|---|---|---|---|
| 1 | **Demande réelle des clients** : produits les plus consultés sans stock, clics WhatsApp par produit, questions fréquentes sans réponse | Données propres du tenant (analyses déjà écrites, `analytics_events`) | Agrégats seulement (aucune conversation lue) | SQL, ~0 |
| 2 | **Prix et disponibilité de concurrents** sur des pages web publiques **que le propriétaire désigne lui-même** | Fiches produit publiques (balisage `schema.org/Product`) | Aucune si on s'en tient aux produits (voir §4) | Récupération HTTP, ~0 ; pas de LLM pour l'extraction |
| 3 | Pubs de concurrents qui visent aussi l'UE/UK | Zernio Ad Library | Noms de Pages | Quota partagé |

Recommandation : **1 puis 2 d'abord, 3 seulement en option** clairement étiquetée « ne couvre que les annonceurs diffusant en Europe ».

## 3. Conception proposée (une fois validée)
- **Règles d'abord** : extraction par code (JSON-LD `Product` / `Offer`, repli sur les balises Open Graph) ; le LLM ne sert qu'à **rédiger** la synthèse à partir de faits calculés (prix, écart en %, date).
- **Tables** `competitor_watches` (organisation, libellé, URL https, produit lié, actif) et `competitor_observations` (date, titre, prix, devise, disponibilité, empreinte) ; RLS (lecture membres, écriture service-role), **rétention bornée** (ex. 12 mois, à décider), suppression en cascade.
- **Récupération sûre** : uniquement des URL **saisies par le tenant** ; https seulement ; **protection SSRF** (adresses privées/internes refusées, y compris après redirection) ; taille et délai bornés ; `robots.txt` respecté ; identifiant de robot clair ; cadence basse par domaine (ex. 1 fois/jour) ; **jamais** de page derrière connexion, de réseau social, ni de contournement de blocage.
- **On ne stocke que des faits** (prix, disponibilité, titre, date), pas la page entière (droit d'auteur).
- **Alertes** calculées en code : concurrent désigné moins cher de N % que mon prix, rupture chez le concurrent (opportunité), changement de prix. Branchées sur `growth-alerts.ts` et les bilans existants.
- **Aucune dépense** (pas de média, pas de pub) : tout est lecture ; pas d'action sensible. Planification par le planificateur de C1.

## 4. Points légaux à faire valider (loi n° 2024/017, en vigueur depuis le 23 juin 2026)
1. **Un nom de commerçant individuel ou de Page peut être une donnée personnelle.** Veille limitée aux produits et prix ; ne pas collecter de noms de personnes, avis nominatifs ni coordonnées. À valider : le cas des entrepreneurs individuels.
2. **Finalité, minimisation, rétention, suppression** à documenter pour chaque donnée collectée (principe commun n° 9) ; durée de conservation à fixer.
3. **Transferts hors du Cameroun** : la récupération se fait depuis l'hébergement (Vercel) ; à confirmer si cela change quelque chose pour des données de commerçants.
4. **Conditions d'utilisation des sites visités** : le propriétaire désigne des pages publiques ; Flexco respecte `robots.txt` et refuse les pages protégées. À valider : la responsabilité si un site interdit la collecte automatisée dans ses conditions.
5. **Réutilisation des visuels de concurrents** : interdite (analyse seulement), y compris dans les pubs et le Studio.
6. **Aucune donnée client** n'est envoyée à une API externe pour cette fonction (les agrégats du point 1 restent dans la base).

## 5. Questions pour Marc-well
1. D'accord pour **réorienter** la veille vers (1) demande réelle des clients et (2) prix de concurrents désignés par le propriétaire, avec l'Ad Library en simple option ?
2. Qui valide les points légaux du §4 (avant la mise en service, pas avant le code) ?
3. Durée de rétention des observations : 12 mois vous convient-il ?
4. Pour le signal n° 1, faut-il se limiter aux **statistiques du site** (déjà disponibles) ou aussi aux **questions posées sur WhatsApp** ? La seconde option touche aux conversations et relève de C3 (assistant client) : elle demande son accord et un traitement agrégé et pseudonymisé.
