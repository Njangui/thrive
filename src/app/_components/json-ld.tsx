import { serializeJsonLd } from "@/lib/seo";

/**
 * Bloc de données structurées schema.org (`<script type="application/ld+json">`).
 *
 * TOUJOURS passer par ce composant plutôt que d'écrire
 * `dangerouslySetInnerHTML={{ __html: JSON.stringify(...) }}` : le
 * `JSON.stringify` nu n'échappe pas `<`, et un nom de boutique ou une
 * description produit contenant `</script>` devient alors une injection de
 * script sur la vitrine (voir `serializeJsonLd`). Le CSP du projet
 * autorise `'unsafe-inline'`, il ne rattrape pas ce cas.
 *
 * Ne rend rien pour `null`/`undefined` : les appelants peuvent passer
 * directement un bloc conditionnel (`productJsonLd`, `faqJsonLd`…).
 */
export function JsonLd({ data }: { data: Record<string, unknown> | null | undefined }) {
  if (!data) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
