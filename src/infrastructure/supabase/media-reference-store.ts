import { getSupabaseServiceClient } from "./server-client";
import {
  SOURCE_URL_MARKER,
  type MediaColumnSpec,
  type MediaReferenceRow,
  type MediaReferenceStore,
} from "@/application/services/media-migration";

/**
 * Accès base de la migration des médias (service-role, hors requête
 * utilisateur : outil d'exploitation lancé à la main). L'isolation tenant
 * repose sur le filtre `orgColumn = organizationId` appliqué à CHAQUE
 * lecture et écriture — il n'existe aucun chemin sans ce filtre.
 */
export class SupabaseMediaReferenceStore implements MediaReferenceStore {
  async findReferences(spec: MediaColumnSpec, organizationId: string, limit: number, afterId: string | null): Promise<MediaReferenceRow[]> {
    let query = getSupabaseServiceClient()
      .from(spec.table)
      .select(`${spec.idColumn}, ${spec.column}`)
      .eq(spec.orgColumn, organizationId)
      .like(spec.column, `%${SOURCE_URL_MARKER}%`)
      .order(spec.idColumn, { ascending: true })
      .limit(limit);
    if (afterId !== null) query = query.gt(spec.idColumn, afterId);

    const { data, error } = await query;
    if (error) throw new Error(`Lecture ${spec.table}.${spec.column} impossible: ${error.message}`);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
      rowId: String(row[spec.idColumn]),
      value: (row[spec.column] as string | null) ?? null,
    }));
  }

  async updateValue(spec: MediaColumnSpec, organizationId: string, rowId: string, expected: string, next: string): Promise<boolean> {
    const { data, error } = await getSupabaseServiceClient()
      .from(spec.table)
      .update({ [spec.column]: next })
      .eq(spec.idColumn, rowId)
      .eq(spec.orgColumn, organizationId)
      .eq(spec.column, expected) // compare-and-set : ne change rien si la ligne a bougé entre-temps
      .select(spec.idColumn);
    if (error) throw new Error(`Écriture ${spec.table}.${spec.column} impossible: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }
}
