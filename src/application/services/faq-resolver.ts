import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { NotFoundError, ValidationError } from "@/lib/errors";

export interface FaqMatch {
  question: string;
  answer: string;
}

/**
 * Cherche une FAQ correspondant au message entrant, sans jamais appeler
 * le LLM (section 18). Correspondance par MOTS, tolérante aux variantes.
 *
 * CORRECTIF (sept. 2026) — la version précédente n'acceptait un mot-clé
 * que s'il apparaissait TEL QUEL dans le message : un mot-clé
 * « livraison » ne se déclenchait donc jamais sur « vous livrez ? », ni
 * « horaire » sur « à quelle heure ouvrez-vous ». Le client n'a aucune
 * raison de reprendre le mot exact configuré par le commerçant, et le
 * message tombait alors dans le reste du pipeline (jusqu'à l'IA, donc
 * jusqu'à une escalade quand elle n'est pas configurée).
 *
 * Règles (voir `wordsMatch`) :
 *  1. un mot-clé peut être une expression (« mode de paiement ») : tous
 *     ses mots significatifs doivent se retrouver dans le message ;
 *  2. deux mots correspondent s'ils sont identiques, ou s'ils partagent
 *     le même radical (livraison ~ livrez ~ livrer) ;
 *  3. à défaut de mot-clé, la QUESTION de la FAQ sert de filet de
 *     sécurité (au moins 2 mots significatifs et 60 % d'entre eux).
 * En cas de plusieurs FAQ candidates, celle qui a le plus de mots-clés
 * touchés (puis le mot-clé le plus long) l'emporte.
 */
export async function matchFaq(organizationId: string, message: string): Promise<FaqMatch | null> {
  const supabase = getSupabaseServiceClient();

  const { data: faqs, error } = await supabase
    .from("faqs")
    .select("question, answer, keywords")
    .eq("organization_id", organizationId)
    .eq("is_active", true);

  if (error) {
    console.error(`matchFaq(${organizationId}) error:`, error.message);
    return null;
  }

  const normalizedMessage = normalize(message);
  const messageTokens = normalizedMessage.split(" ").filter(Boolean);
  if (messageTokens.length === 0) return null;

  let best: { faq: { question: string; answer: string }; hits: number; longest: number } | null = null;

  for (const faq of faqs ?? []) {
    const keywords = ((faq.keywords ?? []) as string[]).map((k) => normalize(String(k))).filter(Boolean);
    let hits = 0;
    let longest = 0;
    for (const keyword of keywords) {
      if (keywordMatches(keyword, normalizedMessage, messageTokens)) {
        hits += 1;
        longest = Math.max(longest, keyword.length);
      }
    }
    if (hits > 0 && (!best || hits > best.hits || (hits === best.hits && longest > best.longest))) {
      best = { faq: { question: faq.question, answer: faq.answer }, hits, longest };
    }
  }
  if (best) return { question: best.faq.question, answer: best.faq.answer };

  // Filet de sécurité : la question elle-même, quand aucun mot-clé ne colle.
  let bestByQuestion: { faq: { question: string; answer: string }; ratio: number } | null = null;
  for (const faq of faqs ?? []) {
    const questionTokens = significantTokens(normalize(faq.question ?? ""));
    if (questionTokens.length < 2) continue;
    const matched = questionTokens.filter((qt) => messageTokens.some((mt) => wordsMatch(qt, mt))).length;
    const ratio = matched / questionTokens.length;
    if (matched >= 2 && ratio >= 0.6 && (!bestByQuestion || ratio > bestByQuestion.ratio)) {
      bestByQuestion = { faq: { question: faq.question, answer: faq.answer }, ratio };
    }
  }
  return bestByQuestion ? { question: bestByQuestion.faq.question, answer: bestByQuestion.faq.answer } : null;
}

const STOP_WORDS = new Set([
  "de", "du", "des", "la", "le", "les", "un", "une", "et", "en", "au", "aux", "ou", "pour", "que", "qui", "sur", "avec",
  "est", "vous", "nous", "votre", "vos", "mon", "ma", "mes", "ce", "cet", "cette", "ces", "pas", "par", "dans", "quel", "quelle",
]);

function significantTokens(normalizedText: string): string[] {
  return normalizedText.split(" ").filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

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

function keywordMatches(keyword: string, normalizedMessage: string, messageTokens: string[]): boolean {
  // Ancien comportement conservé pour les mots-clés assez longs (un radical
  // saisi par le commerçant, ex. « livr », doit continuer à fonctionner) —
  // mais jamais pour 1 à 3 lettres, où « ci »/« eau » se retrouvaient dans
  // « merci »/« beaucoup ».
  if (keyword.length >= 4 && normalizedMessage.includes(keyword)) return true;

  const keywordTokens = significantTokens(keyword);
  if (keywordTokens.length === 0) {
    // Mot-clé fait uniquement de mots vides ou très courts (« ou », « 24h ») :
    // correspondance exacte sur mots entiers, jamais en sous-chaîne.
    return ` ${normalizedMessage} `.includes(` ${keyword} `);
  }
  return keywordTokens.every((kt) => messageTokens.some((mt) => wordsMatch(kt, mt)));
}

/** Minuscules, sans accents, ponctuation → espaces (« vous-livrez ? » → « vous livrez »). */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Lot 3 (audit master prompt §25/§29) — le mécanisme de résolution
 * ci-dessus fonctionne et est déjà prioritaire sur l'IA (voir
 * conversation-orchestrator.ts), mais rien ne permettait à un commerçant
 * d'en créer une seule depuis le dashboard : la fonctionnalité était
 * fonctionnellement injoignable malgré un backend correct. CRUD minimal
 * ci-dessous, consommé par /dashboard/faq.
 */

export interface FaqSummary {
  id: string;
  question: string;
  answer: string;
  keywords: string[];
  isActive: boolean;
}

export async function listFaqs(organizationId: string): Promise<FaqSummary[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("faqs")
    .select("id, question, answer, keywords, is_active")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Erreur lecture FAQ: ${error.message}`);

  return (data ?? []).map((f) => ({
    id: f.id,
    question: f.question,
    answer: f.answer,
    keywords: f.keywords ?? [],
    isActive: f.is_active,
  }));
}

export interface CreateFaqInput {
  organizationId: string;
  question: string;
  answer: string;
  keywords: string[];
}

/**
 * `keywords` pilote directement le matching (`matchFaq` ci-dessus, par
 * mot-clé, jamais sémantique en V1) — une FAQ sans mot-clé ne sera donc
 * jamais déclenchée automatiquement. Refuser sa création plutôt que de
 * laisser un commerçant croire qu'elle est active alors qu'elle est
 * fonctionnellement invisible du router.
 */
export async function createFaq(input: CreateFaqInput): Promise<{ faqId: string }> {
  if (!input.question.trim()) throw new ValidationError("La question est requise.");
  if (!input.answer.trim()) throw new ValidationError("La réponse est requise.");
  if (input.keywords.length === 0) {
    throw new ValidationError("Au moins un mot-clé est requis pour que cette FAQ puisse être détectée.");
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("faqs")
    .insert({
      organization_id: input.organizationId,
      question: input.question,
      answer: input.answer,
      keywords: input.keywords,
      is_active: true,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Impossible de créer la FAQ: ${error?.message}`);
  return { faqId: data.id };
}

export interface UpdateFaqInput {
  question?: string;
  answer?: string;
  keywords?: string[];
  isActive?: boolean;
}

export async function updateFaq(organizationId: string, faqId: string, input: UpdateFaqInput): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (input.question !== undefined) {
    if (!input.question.trim()) throw new ValidationError("La question est requise.");
    patch.question = input.question;
  }
  if (input.answer !== undefined) {
    if (!input.answer.trim()) throw new ValidationError("La réponse est requise.");
    patch.answer = input.answer;
  }
  if (input.keywords !== undefined) patch.keywords = input.keywords;
  if (input.isActive !== undefined) patch.is_active = input.isActive;

  const supabase = getSupabaseServiceClient();
  const { error, count } = await supabase
    .from("faqs")
    .update(patch, { count: "exact" })
    .eq("id", faqId)
    .eq("organization_id", organizationId);

  if (error) throw new Error(`Impossible de mettre à jour la FAQ: ${error.message}`);
  if (!count) throw new NotFoundError("FAQ introuvable.");
}

export async function deleteFaq(organizationId: string, faqId: string): Promise<void> {
  const supabase = getSupabaseServiceClient();
  const { error, count } = await supabase
    .from("faqs")
    .delete({ count: "exact" })
    .eq("id", faqId)
    .eq("organization_id", organizationId);

  if (error) throw new Error(`Impossible de supprimer la FAQ: ${error.message}`);
  if (!count) throw new NotFoundError("FAQ introuvable.");
}
