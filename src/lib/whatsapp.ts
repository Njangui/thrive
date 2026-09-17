/**
 * Construit un lien wa.me avec message pré-rempli (section 12 : CTA
 * WhatsApp). Pure fonction de formatage de chaîne — aucune dépendance
 * réseau, aucun état.
 *
 * EXTRAIT de `src/infrastructure/tenant/resolve-request-tenant.ts`
 * (chantier vitrine V2) où elle vivait à côté de `resolveRequestTenant`/
 * `resolveRequestOrigin`. Problème concret que ça posait : ces deux
 * dernières sont enveloppées dans `cache()` de React, qui n'existe QUE
 * dans la condition d'exports "react-server" que le bundler de Next.js
 * résout — `cache` est `undefined` sous la résolution Node/CJS classique
 * qu'utilise Vitest. Résultat, tout module import ait `buildWhatsAppLink`
 * (fiche produit, fiche prestation, `storefront-service.ts`) chargeait de
 * fait tout `resolve-request-tenant.ts`, donc plantait dès qu'un test
 * unitaire l'important sans le mocker explicitement — y compris pour ne
 * tester qu'une fonction pure sans aucun rapport avec la résolution de
 * tenant. Un helper pur ne doit pas hériter des contraintes runtime de
 * son voisin de fichier.
 *
 * `resolve-request-tenant.ts` réexporte toujours `buildWhatsAppLink` pour
 * ne casser aucun import existant.
 */
export function buildWhatsAppLink(whatsappNumber: string, prefilledText: string): string {
  const digitsOnly = whatsappNumber.replace(/[^\d]/g, "");
  return `https://wa.me/${digitsOnly}?text=${encodeURIComponent(prefilledText)}`;
}
