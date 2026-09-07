-- ============================================================
-- 0013_storage_tenant_media_bucket.sql
-- Lot E, Partie 1 — Upload de médias réel.
--
-- Numérotée 0013 : la dernière migration présente dans CE dépôt est 0010,
-- mais 00_CONVENTIONS_COMMUNES.md indique que 0012 existe déjà dans le
-- projet réel (autres lots, non fournis dans cet environnement). 0013 est
-- donc le numéro le moins susceptible d'entrer en collision ; en cas de
-- collision à la fusion, renumérotation sans risque (convention commune).
--
-- ⚠️ Cette migration modifie `storage.*`, un schéma géré par Supabase.
-- Si votre CLI/SQL Editor ne permet pas d'exécuter contre `storage.objects`
-- (droits insuffisants sur certains projets Supabase), voir
-- `docs/DEPLOYMENT.md` section "Bucket de médias tenant" pour la procédure
-- manuelle équivalente (dashboard Supabase Storage).
-- ============================================================

-- ------------------------------------------------------------
-- Bucket unique pour tous les médias tenant : produits, logo, bannière,
-- favicon (voir application/services/media-service.ts). PUBLIC car ces
-- images sont déjà exposées publiquement sur la vitrine (section 12) —
-- pas de justification à des URLs signées ici.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('tenant-media', 'tenant-media', true, 5242880) -- 5 Mo, aligné sur MAX_UPLOAD_BYTES (media-service.ts)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- Politique de nommage des objets : `{organization_id}/{type}/{uuid}-{nom}`
-- (cahier Lot E Partie 1). `storage.foldername(name)` renvoie les segments
-- de dossier de l'objet — le premier segment est donc l'organization_id.
-- Isolation tenant même dans le stockage de fichiers, comme pour toute
-- autre table (00_CONVENTIONS_COMMUNES.md, section Sécurité).
--
-- Note : `storage.objects` a RLS activé par défaut sur tout projet
-- Supabase — pas de `alter table ... enable row level security` ici (on
-- ne le désactive/réactive jamais sur un schéma système).
--
-- Ces policies sont un FILET DE SÉCURITÉ : le chemin applicatif normal
-- passe par le service-role (SupabaseStorageAdapter, qui bypass RLS) et
-- est protégé en amont par `requireMembership()` dans les Server Actions
-- (double barrière). Si un accès direct depuis un client scopé
-- utilisateur est ajouté plus tard, ces policies s'appliqueront.
-- ------------------------------------------------------------
create policy "members can read tenant-media of their org"
on storage.objects for select
using (
  bucket_id = 'tenant-media'
  and is_member_of_org((storage.foldername(name))[1]::uuid)
);

create policy "members can upload tenant-media of their org"
on storage.objects for insert
with check (
  bucket_id = 'tenant-media'
  and is_member_of_org((storage.foldername(name))[1]::uuid)
);

create policy "members can update tenant-media of their org"
on storage.objects for update
using (
  bucket_id = 'tenant-media'
  and is_member_of_org((storage.foldername(name))[1]::uuid)
);

create policy "members can delete tenant-media of their org"
on storage.objects for delete
using (
  bucket_id = 'tenant-media'
  and is_member_of_org((storage.foldername(name))[1]::uuid)
);

-- Le bucket étant public, la lecture anonyme (vitrine publique, section 12)
-- passe par l'URL publique Supabase Storage, qui contourne RLS pour les
-- buckets `public = true` — la policy SELECT ci-dessus ne couvre que les
-- lectures via un client authentifié scopé utilisateur (ex: prévisualisation
-- dans le dashboard), pas la vitrine anonyme.
