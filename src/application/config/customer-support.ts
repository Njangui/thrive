/**
 * Service client — numéros WhatsApp officiels affichés dans le dashboard
 * (page /dashboard/support). Source unique : pour changer ou ajouter un
 * numéro, modifier uniquement cette liste.
 *
 * `digits` : format international sans « + » ni espaces (celui qu'attend
 * `https://wa.me/<digits>`).
 */
export interface SupportContact {
  label: string;
  digits: string;
  display: string;
}

export const SUPPORT_CONTACTS: SupportContact[] = [
  { label: "Service client — ligne 1", digits: "237656106225", display: "+237 656 10 62 25" },
  { label: "Service client — ligne 2", digits: "237657380954", display: "+237 657 38 09 54" },
];

export function supportWhatsAppUrl(contact: SupportContact, organizationName?: string): string {
  const intro = organizationName
    ? `Bonjour, je suis ${organizationName} sur Flexco et j'ai besoin d'aide.`
    : "Bonjour, j'ai besoin d'aide sur Flexco.";
  return `https://wa.me/${contact.digits}?text=${encodeURIComponent(intro)}`;
}
