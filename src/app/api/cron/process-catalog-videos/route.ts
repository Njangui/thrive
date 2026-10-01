import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { notifyExpiringCatalogVideos, renewExpiringZernioVideos } from "@/application/services/catalog-video-service";

export const maxDuration = 300;

/**
 * Lot P — entretien des vidéos du catalogue hébergées chez Zernio (7 jours
 * de conservation réelle) : (1) RENOUVELLEMENT avant la fermeture de la
 * fenêtre Zernio, pour honorer les 7/30/90 jours promis par l'offre, (2)
 * NOTIFICATION des commerçants ~3 jours avant l'échéance de l'offre.
 *
 * Fréquence conseillée : toutes les 4 à 6 heures (le renouvellement se
 * déclenche 36 h avant l'échéance réelle — voir RENEWAL_MARGIN_MS — donc
 * plusieurs passages ont le temps de retenter avant qu'une vidéo ne
 * devienne réellement indisponible). `maxDuration` élevé à dessein :
 * chaque renouvellement retélécharge puis retéléverse le fichier ENTIER
 * (jusqu'à 200 Mo) — NON VÉRIFIÉ EN CONDITIONS RÉELLES, voir RAPPORT_LOT_P.md.
 */
export async function GET(request: Request) {
  const auth = verifyCronAuth(request);
  if (!auth.authorized) {
    return NextResponse.json(auth.body, { status: auth.status });
  }
  try {
    const renewal = await renewExpiringZernioVideos();
    const notify = await notifyExpiringCatalogVideos();
    return NextResponse.json({ ok: true, renewal, notify });
  } catch (error) {
    console.error("/api/cron/process-catalog-videos: échec:", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Erreur interne" }, { status: 500 });
  }
}
