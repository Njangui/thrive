import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";

const HOURS_KEYWORDS = ["horaire", "ouvert", "ferm", "heure"];
const ADDRESS_KEYWORDS = ["adresse", "localis", "ou etes-vous", "ou se trouve"];
const CONTACT_KEYWORDS = ["contact", "telephone", "numero", "appeler", "email"];

export type BusinessInfoTopic = "hours" | "address" | "contact" | null;

export function detectBusinessInfoTopic(message: string): BusinessInfoTopic {
  const normalized = normalize(message);
  if (HOURS_KEYWORDS.some((k) => normalized.includes(k))) return "hours";
  if (ADDRESS_KEYWORDS.some((k) => normalized.includes(k))) return "address";
  if (CONTACT_KEYWORDS.some((k) => normalized.includes(k))) return "contact";
  return null;
}

/**
 * Répond directement depuis `organizations` (section 19 : "NE PAS envoyer
 * toute la base au LLM" — ici on ne l'appelle même pas). Renvoie null si
 * la donnée demandée n'est pas renseignée par le commerçant, pour laisser
 * l'orchestrateur décider d'un fallback (IA ou human handoff) plutôt que
 * d'inventer une réponse vide.
 */
export async function resolveBusinessInfo(
  organizationId: string,
  topic: NonNullable<BusinessInfoTopic>,
): Promise<string | null> {
  const supabase = getSupabaseServiceClient();
  const { data: org, error } = await supabase
    .from("organizations")
    .select("opening_hours, address, phone, whatsapp_number, email")
    .eq("id", organizationId)
    .single();

  if (error || !org) return null;

  switch (topic) {
    case "hours": {
      const hours = org.opening_hours as Record<string, string> | null;
      if (!hours || Object.keys(hours).length === 0) return null;
      return Object.entries(hours)
        .map(([day, range]) => `${day} : ${range}`)
        .join("\n");
    }
    case "address":
      return org.address ?? null;
    case "contact": {
      const parts = [
        org.phone ? `Téléphone : ${org.phone}` : null,
        org.whatsapp_number ? `WhatsApp : ${org.whatsapp_number}` : null,
        org.email ? `Email : ${org.email}` : null,
      ].filter(Boolean);
      return parts.length > 0 ? parts.join("\n") : null;
    }
  }
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
