# Analytics de la vitrine (landing)

Mis en place en sept. 2026. Page : `/dashboard/analytics/landing`. Migration : `0060_landing_analytics.sql`.

- **Collecte** : `<StorefrontPageTracker />` (navigateur) appelle `trackPageViewAction` à chaque page de la vitrine. Le tenant est résolu côté serveur depuis l'hôte. Les robots (qui n'exécutent pas JS, ou dont le user-agent est connu) sont écartés.
- **Sans cookie** : « visiteur » = HMAC(organisation + jour + IP + navigateur), clé = `SUPABASE_SERVICE_ROLE_KEY`. Visiteurs uniques **par jour** ; aucun suivi d'un jour à l'autre.
- **Provenance** : `utm_source` prime sur le referrer (les apps mobiles n'envoient souvent aucun referrer). Exemple : `https://ma-boutique…/?utm_source=facebook`. Seule la première page d'une session (onglet) porte source, appareil et pays.
- **Événements lus** : `page_view`, `product_view`, `product_click`, `cta_click`, `video_play` (nouveau), `lead_created`, `order_created`.
- **Anciennes données** : les `page_view` d'avant 0060 n'ont pas de métadonnées ; ils comptent comme des vues de la page d'accueil, sans visiteur ni provenance.
- Le `page_view` serveur de `src/app/page.tsx` a été retiré (le traceur navigateur le remplace — sinon double comptage). Le compteur « activité 30 j » du dashboard compte désormais aussi les pages internes de la vitrine.
