import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

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
