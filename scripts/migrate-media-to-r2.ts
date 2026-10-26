/**
 * Migration des médias d'UN tenant : Supabase Storage -> Cloudflare R2 (C4).
 *
 *   npm run media:migrate-r2 -- --org <uuid>                 # simulation (défaut) : n'écrit rien
 *   npm run media:migrate-r2 -- --org <uuid> --apply         # copie, vérifie, réécrit les URL
 *   options : --max-mb 25   --out rapport.json
 *
 * Prérequis : STORAGE_PROVIDER=r2 et R2_* dans .env.local (voir docs/DEPLOYMENT.md,
 * « Médias sur Cloudflare R2 »), et le domaine public R2 déjà autorisé dans
 * next.config.mjs (variable R2_PUBLIC_BASE_URL présente au build).
 * Les fichiers Supabase ne sont JAMAIS supprimés. Le rapport JSON contient la
 * table ancien -> nouveau (retour arrière). Détails : docs/agents/c4-medias-r2.md.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import { writeFileSync } from "node:fs";
import { getStorageProvider } from "@/infrastructure/providers/registry";
import { SupabaseMediaReferenceStore } from "@/infrastructure/supabase/media-reference-store";
import { DEFAULT_MAX_FILE_BYTES, migrateOrganizationMedia, type SourceFetch } from "@/application/services/media-migration";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const organizationId = arg("org");
  if (!organizationId || !/^[0-9a-f-]{36}$/i.test(organizationId)) {
    throw new Error("--org <uuid> est requis (un tenant à la fois).");
  }
  const apply = process.argv.includes("--apply");
  const maxFileBytes = arg("max-mb") ? Number(arg("max-mb")) * 1024 * 1024 : DEFAULT_MAX_FILE_BYTES;
  if (!Number.isFinite(maxFileBytes) || maxFileBytes <= 0) throw new Error("--max-mb invalide");

  const target = await getStorageProvider(organizationId);
  if (target.providerName !== "r2") {
    throw new Error(`STORAGE_PROVIDER doit valoir "r2" pour migrer (actuel : "${target.providerName}").`);
  }

  const report = await migrateOrganizationMedia(
    {
      store: new SupabaseMediaReferenceStore(),
      target,
      async fetchSource(url, maxBytes): Promise<SourceFetch> {
        try {
          // `redirect: "error"` : une URL validée ne doit jamais nous mener ailleurs.
          const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
          if (!response.ok) return { ok: false, reason: `HTTP ${response.status}` };
          const declared = Number(response.headers.get("content-length") ?? 0);
          if (declared > maxBytes) return { ok: false, reason: `fichier trop volumineux (${declared} octets)` };
          return { ok: true, data: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") ?? "" };
        } catch (error) {
          return { ok: false, reason: error instanceof Error ? error.message : "téléchargement impossible" };
        }
      },
      async verifyPublic(url) {
        try {
          const response = await fetch(url, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(15_000) });
          const length = response.headers.get("content-length");
          return { ok: response.ok, contentLength: length === null ? null : Number(length) };
        } catch {
          return { ok: false, contentLength: null };
        }
      },
    },
    { organizationId, apply, maxFileBytes },
  );

  const out = arg("out") ?? `migration-media-${organizationId}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(out, JSON.stringify(report, null, 2));

  console.log(apply ? "MIGRATION APPLIQUÉE" : "SIMULATION (rien n'a été écrit — relancer avec --apply)");
  console.log(`  références trouvées     : ${report.referencesFound}`);
  console.log(`  hors périmètre ignorées : ${report.skippedForeign}`);
  if (apply) {
    console.log(`  fichiers copiés         : ${report.filesCopied} (${(report.bytesCopied / 1024 / 1024).toFixed(1)} Mo)`);
    console.log(`  déjà présents           : ${report.filesAlreadyPresent}`);
    console.log(`  lignes réécrites        : ${report.rowsRewritten}`);
    console.log(`  modifiées entre-temps   : ${report.rowsChangedConcurrently} (relancer)`);
    console.log(`  échecs                  : ${report.failures.length}`);
    for (const failure of report.failures.slice(0, 20)) {
      console.log(`    - ${failure.table}.${failure.column} [${failure.rowId}] : ${failure.reason}`);
    }
  }
  console.log(`  rapport (retour arrière): ${out}`);
  if (apply && report.failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Échec :", error instanceof Error ? error.message : error);
  process.exit(1);
});
