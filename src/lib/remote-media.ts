/**
 * Téléchargement SÉCURISÉ d'un média distant pour le republier nous-mêmes
 * (Telegram, YouTube) — le cas des vidéos stockées chez Zernio : Zernio ne
 * publie pas sur ces deux canaux, c'est NOTRE serveur qui relit le fichier
 * au moment voulu puis le dépose chez Telegram / YouTube.
 *
 * Liste blanche d'hôtes : cette fonction reçoit des URLs issues de la base
 * ou d'un formulaire ; sans filtre, elle permettrait de faire télécharger
 * n'importe quelle adresse (y compris interne) au serveur (SSRF).
 */

/** Limite d'envoi Telegram par téléversement direct (Bot API) : 50 Mo. Par URL, ce serait 20 Mo seulement. */
export const TELEGRAM_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

const ZERNIO_MEDIA_HOST = "media.zernio.com";

function parseHttps(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

export function isZernioMediaHost(url: string): boolean {
  return parseHttps(url)?.hostname === ZERNIO_MEDIA_HOST;
}

/** Hôtes dont on accepte de relire un fichier : le stockage temporaire Zernio et le Storage Supabase du projet. */
export function isAllowedRemoteMediaHost(url: string): boolean {
  const hostname = parseHttps(url)?.hostname;
  if (!hostname) return false;
  return hostname === ZERNIO_MEDIA_HOST || hostname.endsWith(".supabase.co");
}

export function fileNameFromUrl(url: string, fallback = "fichier"): string {
  const last = parseHttps(url)?.pathname.split("/").filter(Boolean).pop();
  return last ? decodeURIComponent(last).slice(-120) : fallback;
}

export async function downloadRemoteMedia(
  url: string,
  maxBytes: number,
): Promise<{ data: Uint8Array; contentType: string | null }> {
  if (!isAllowedRemoteMediaHost(url)) throw new Error("Adresse de média non autorisée.");

  const response = await fetch(url, { redirect: "follow" });
  // Une redirection ne doit jamais nous mener hors de la liste blanche.
  if (!isAllowedRemoteMediaHost(response.url || url)) throw new Error("Adresse de média non autorisée.");

  if (!response.ok) {
    throw new Error(
      isZernioMediaHost(url)
        ? "La vidéo n'est plus disponible chez Zernio (elle a probablement expiré : Zernio ne conserve les fichiers que 7 jours). Téléversez-la à nouveau."
        : `Le média n'a pas pu être récupéré (${response.status}).`,
    );
  }

  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    throw new Error(`Fichier trop volumineux (${Math.round(declared / 1024 / 1024)} Mo, maximum ${Math.round(maxBytes / 1024 / 1024)} Mo).`);
  }
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength > maxBytes) {
    throw new Error(`Fichier trop volumineux (${Math.round(data.byteLength / 1024 / 1024)} Mo, maximum ${Math.round(maxBytes / 1024 / 1024)} Mo).`);
  }
  return { data, contentType: response.headers.get("content-type") };
}
