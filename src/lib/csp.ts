/**
 * Content-Security-Policy (audit SEC1/QA3). Source unique côté TypeScript ; `next.config.mjs` (JS pur)
 * en garde une copie statique et `csp.test.ts` échoue si les deux divergent.
 *
 * Deux modes :
 *  - statique (défaut) : `script-src 'self' 'unsafe-inline'` ;
 *  - nonce (CSP_NONCE=true) : `script-src 'self' 'nonce-…' 'strict-dynamic'`, appliqué par `src/proxy.ts`.
 *    Next.js propage le nonce aux scripts qu'il injecte ; les pages deviennent rendues à la demande
 *    (pas de cache statique) — à valider sur le staging avant de l'activer en production.
 *
 * Les hôtes Supabase sont restreints au projet (NEXT_PUBLIC_SUPABASE_URL), jamais `*.supabase.co`.
 */
export interface CspOptions {
  /** Nonce du mode strict ; absent = mode statique. */
  nonce?: string;
  /** Hôte du projet Supabase (ex. abcd.supabase.co) ; absent = aucune entrée Supabase. */
  supabaseHost?: string | null;
  /** Origine publique R2 (https://media.example.com), si configurée. */
  r2Origin?: string | null;
}

export function supabaseHostFromEnv(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.hostname : null;
  } catch {
    return null;
  }
}

export function buildCsp({ nonce, supabaseHost, r2Origin }: CspOptions = {}): string {
  const sb = supabaseHost ? ` https://${supabaseHost}` : "";
  const r2 = r2Origin ? ` ${r2Origin}` : "";
  return [
    "default-src 'self'",
    nonce ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'` : "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data:${sb} https://picsum.photos${r2}`,
    "font-src 'self'",
    `connect-src 'self'${sb} https://media.zernio.com https://*.r2.cloudflarestorage.com`,
    `media-src 'self' blob:${sb} https://media.zernio.com${r2}`,
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}
