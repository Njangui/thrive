/**
 * Emoji drapeau calculé depuis le code ISO (algorithme standard des
 * "regional indicator symbols" Unicode) — repli d'affichage quand
 * `flagUrl` est absent (pays saisi manuellement, pas encore synchronisé
 * avec une image NotchPay). Jamais stocké en base : calculé à la
 * volée, purement côté présentation.
 *
 * Extrait de `country-service.ts` (qui importe `getSupabaseServiceClient`
 * / `env.ts`) pour que les composants CLIENT (ex: africa-availability-map.tsx)
 * puissent l'utiliser sans entraîner tout ce fichier — et donc la
 * validation stricte des secrets serveur — dans le bundle navigateur.
 * Ce fichier ne doit avoir AUCUNE dépendance vers `country-service.ts`,
 * `server-client.ts` ou `env.ts` : c'est précisément ce qui le rend sûr à
 * importer depuis un composant client.
 */
export function isoCodeToFlagEmoji(isoCode: string): string {
  const upper = isoCode.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return "🏳️";
  const codePoints = [...upper].map((c) => 127397 + c.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}