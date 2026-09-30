/** Lien `tel:` à partir d'un numéro saisi librement. `null` si trop court pour être un numéro utilisable. */
export function getPhoneHref(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/[^\d+]/g, "");
  return digits.length >= 6 ? `tel:${digits}` : null;
}
