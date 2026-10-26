# C4 — Médias : migration Supabase Storage → Cloudflare R2

## Ce qui est livré
- Adaptateur R2 (`R2StorageAdapter`, voir `c4-r2.md`) + erreur typée `StorageObjectExistsError` (412).
- `next.config.mjs` : le domaine public R2 (`R2_PUBLIC_BASE_URL`) est autorisé pour `next/image` **et** dans le CSP (`img-src`, `media-src`). **Sans cela, `STORAGE_PROVIDER=r2` casse toutes les images** (le CSP et `remotePatterns` n'autorisaient que `*.supabase.co`). La variable est lue **au build** : elle doit exister dans les variables Vercel avant le déploiement.
- `media-migration.ts` (logique + ports testables), `SupabaseMediaReferenceStore`, script `npm run media:migrate-r2`.

- `isOptimizableImageUrl` reconnaît l'hôte R2 (variable publique `NEXT_PUBLIC_R2_MEDIA_HOST`, posée au build par `next.config.mjs`). Sans cela, les photos R2 passaient par `<img>` en taille d'origine, ce qui est lourd sur mobile : la CSP les autorisait, mais pas l'optimisation.

## Procédure recommandée (un tenant de test d'abord)
1. Créer bucket, jeton et domaine public (`docs/DEPLOYMENT.md`, section R2). Définir `R2_*` et `STORAGE_PROVIDER=supabase` dans Vercel, **redéployer** (autorise le domaine R2 pour les images et le CSP).
2. Vérifier à la main qu'une image servie depuis le domaine R2 s'affiche sur une vitrine (console navigateur : aucune erreur CSP).
3. En local, `.env.local` avec `STORAGE_PROVIDER=r2` + `R2_*` + accès Supabase service-role. **Simulation** : `npm run media:migrate-r2 -- --org <uuid>` (n'écrit rien).
4. `--apply` sur le tenant de test ; contrôler visuellement vitrine, dashboard, fiches produits.
5. Passer `STORAGE_PROVIDER=r2` en production (les nouveaux envois vont sur R2), puis migrer les tenants un par un.
6. **Conserver les fichiers Supabase au moins 30 jours** (aucune suppression n'est faite par l'outil). Les anciennes URL restent valides.

## Garanties (testées avec des faux : 10 cas)
- Copier, jamais déplacer ; réécriture d'une URL **seulement** après vérification que la copie est servie par le domaine public avec la même taille.
- Idempotent et reprenable (fichier déjà présent reconnu ; ligne déjà réécrite ne correspond plus au filtre) ; compare-and-set : une ligne modifiée entre-temps est laissée telle quelle et comptée.
- Un seul tenant par lancement ; seules les URL du dossier de ce tenant sont lues (hôte `*.supabase.co`, https, pas de `..`).
- SVG exclu (script possible s'il est ouvert directement), 25 Mo max par fichier (`--max-mb`), redirections refusées.

## Retour arrière
Le rapport JSON (`--out`) contient `rewrites` (table, colonne, ligne, ancienne et nouvelle URL). Pour revenir en arrière : réécrire chaque `to` par son `from` (les fichiers Supabase existent encore). Un outil de retour arrière automatique n'est **pas** livré.

## Périmètre des colonnes (à valider)
Migrées : `organizations` (logo, bannière, favicon, image de partage), `organization_landing_config.hero_media_url`, `product_images.url`, `service_images.url`, `categories.image_url`.
**Non migrées volontairement** : `social_posts.media_urls`, `telegram_publications.attachment_url`, `contact_broadcasts.image_url` (C5 : envois programmés), pièces jointes de messagerie (C2/C3), `expenses.receipt_url` (justificatifs privés), vidéos catalogue (envoyées directement à Zernio). Leurs URL Supabase restent valides.

**Colonnes oubliées ?** Cette requête (à lancer dans l'éditeur SQL Supabase, lecture seule) liste toute colonne texte, tableau ou jsonb contenant une URL du bucket — y compris du jsonb (ex. configuration de sections) que l'outil ne réécrit pas :
```sql
do $$
declare r record; n bigint;
begin
  for r in
    select c.table_name, c.column_name, c.data_type
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.data_type in ('text', 'ARRAY', 'jsonb')
  loop
    execute format('select count(*) from %I where %s like %L', r.table_name,
      case r.data_type when 'ARRAY' then format('array_to_string(%I, '','')', r.column_name)
                       when 'jsonb' then format('%I::text', r.column_name)
                       else format('%I', r.column_name) end,
      '%/storage/v1/object/public/tenant-media/%') into n;
    if n > 0 then raise notice '%.% (%) : % ligne(s)', r.table_name, r.column_name, r.data_type, n; end if;
  end loop;
end $$;
```

## Variantes d'images — décision
**Pas de variantes stockées** à ce stade : `next/image` génère déjà à la demande des tailles adaptées (et le cache de Vercel). Stocker des miniatures dupliquerait le stockage sans gain mesuré. À revoir si le coût d'optimisation d'images Vercel devient significatif (**à mesurer**) ; Cloudflare propose des transformations d'images mais leur disponibilité et leur tarif sont **à vérifier**.

## Non fait / non vérifié
- Rien n'a été exécuté contre un vrai Supabase ni un vrai R2 (pas de réseau ici) : le comportement réel de `If-None-Match: *` (412) et du `Content-Length` d'un `HEAD` sur le domaine public R2 est à confirmer sur le tenant de test.
- Pas de limite de débit ni de parallélisme : les fichiers sont copiés un par un (lent mais sûr).
- Les URL absolues sont stockées en base (pas de chemins relatifs) : un changement de domaine R2 imposerait une nouvelle migration.
