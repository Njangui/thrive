import { NextResponse } from "next/server";
import { listPublicCountries } from "@/application/services/country-service";

/**
 * Country Engine — API publique (section 23). Revalidée toutes les 5
 * minutes plutôt que `force-dynamic` : les données viennent de notre
 * propre DB (déjà synchronisée depuis NotchPay en tâche de fond, voir
 * notchpay-resources-service.ts), pas de NotchPay en direct — un
 * changement de statut Super Admin met au plus 5 minutes à apparaître
 * ici, ce qui est largement suffisant pour une page vitrine (section
 * 45 : éviter le N+1, pas la peine d'interroger la DB à chaque visite).
 *
 * NE RENVOIE JAMAIS : secrets, credentials, clé NotchPay, metadata
 * interne, informations Super Admin (section 23) —
 * `listPublicCountries()` (country-service.ts) garantit déjà cette
 * restriction en amont ; ce fichier ne fait qu'une projection
 * supplémentaire vers la forme JSON demandée par le cahier.
 */
export const revalidate = 300;

export async function GET() {
  try {
    const countries = await listPublicCountries();

    return NextResponse.json({
      countries: countries.map((c) => ({
        code: c.isoCode,
        name: c.name,
        currency: c.currencyCode,
        phoneCode: c.phoneCode,
        status: c.launchStatus,
      })),
    });
  } catch (error) {
    console.error("GET /api/public/countries: erreur de lecture, réponse vide plutôt qu'une 500 sur une page publique:", error);
    return NextResponse.json({ countries: [] }, { status: 200 });
  }
}
