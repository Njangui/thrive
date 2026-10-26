/**
 * Hôte du projet Supabase (NEXT_PUBLIC_SUPABASE_URL). Audit SEC2/QA3 : on n'accepte plus n'importe quel
 * `*.supabase.co` (projet d'un tiers), uniquement le nôtre. Sans variable valide : aucun hôte accepté.
 */
export function projectSupabaseHost(): string | null {
  try {
    const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    return u.protocol === "https:" ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function isProjectSupabaseHost(hostname: string): boolean {
  const own = projectSupabaseHost();
  return own !== null && hostname.toLowerCase() === own;
}
