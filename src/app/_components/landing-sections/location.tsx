import type { TenantContext } from "@/infrastructure/tenant/resolve-request-tenant";

/**
 * `google.com/maps/search` avec `api=1` : format d'URL publique
 * documenté par Google (aucune clé API requise, contrairement à l'API
 * Maps Embed) — fonctionne réellement, pas un lien décoratif.
 */
function buildGoogleMapsSearchUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function LocationSection({ tenant }: { tenant: TenantContext }) {
  if (!tenant.address) return null;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-ink/10 bg-white p-5">
      <h2 className="font-display text-lg font-semibold">Nous trouver</h2>
      <p className="text-sm text-muted">{tenant.address}</p>
      <a
        href={buildGoogleMapsSearchUrl(tenant.address)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex w-fit items-center gap-1 text-sm font-medium text-brand hover:underline"
      >
        Ouvrir dans Google Maps →
      </a>
    </section>
  );
}
