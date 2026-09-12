import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { NotFoundError, ValidationError } from "@/lib/errors";

export interface FaqMatch {
  question: string;
  answer: string;
}

/**
 * Cherche une FAQ correspondant au message entrant, uniquement par
 * correspondance de mots-clés (section 18 : "NE PAS appeler le LLM").
 * Volontairement simple : un match si au moins un mot-clé de la FAQ
 * apparaît dans le message (normalisé, sans accents). Une recherche plus
 * fine (score, plusieurs mots-clés requis) peut être affinée plus tard
 * avec de vrais cas d'usage — pas de sur-ingénierie prématurée.
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

  for (const faq of faqs ?? []) {
    const keywords = (faq.keywords ?? []) as string[];
    const hasMatch = keywords.some((keyword) => normalizedMessage.includes(normalize(keyword)));
    if (hasMatch) {
      return { question: faq.question, answer: faq.answer };
    }
  }

  return null;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
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
