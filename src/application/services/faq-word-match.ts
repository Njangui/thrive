/**
 * Correspondance de mots du moteur de FAQ — module pur, sans dépendance (partagé par
 * faq-resolver et faq-learning : aucun des deux ne doit tirer l'accès base de l'autre).
 */

/**
 * Deux mots (déjà normalisés) se correspondent s'ils sont identiques ou
 * partagent un radical. Prudent volontairement : un mot court (≤ 5
 * lettres) doit être le DÉBUT de l'autre (heure/heures, tarif/tarifs) —
 * jamais un simple préfixe commun, sinon « livre » (l'objet) déclencherait
 * une FAQ « livraison ». Pour les mots plus longs, un radical commun d'au
 * moins 4 lettres couvrant l'essentiel du plus court suffit
 * (livraison/livrez/livrer).
 */
export function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  if (minLen < 3) return false;
  if (minLen <= 5) return a.startsWith(b) || b.startsWith(a);
  let common = 0;
  while (common < minLen && a[common] === b[common]) common += 1;
  return common >= Math.max(4, minLen - 2);
}
