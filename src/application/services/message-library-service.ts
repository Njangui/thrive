import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { requireMembership } from "./auth-service";
import { DEFAULT_BRAND_VOICE, parseBrandVoiceInput, voiceFromRow, type BrandVoice, type EmojiLevel, type Register } from "./brand-voice";
import { createMessageLibrary, validateOverrideBody, type LibraryOverride, type MessageLibrary } from "./message-library";
import { ValidationError } from "@/lib/errors";

/**
 * C3 — accès base de la voix de marque et des messages prédéfinis (livrable E).
 *
 * Isolation (principe 5) : client service-role, donc chaque requête filtre
 * explicitement sur `organization_id` ; les écritures exigent un propriétaire ou
 * un administrateur de CE tenant (`requireMembership`). La lecture à l'exécution
 * (`loadVoiceAndLibrary`) est celle de l'assistant, sans utilisateur : elle ne
 * renvoie que des surcharges `approved`.
 */

export interface VoiceAndLibrary {
  voice: BrandVoice;
  library: MessageLibrary;
}

/** Ne lève JAMAIS : sans voix ni surcharge, l'assistant parle avec la voix par défaut. */
export async function loadVoiceAndLibrary(organizationId: string): Promise<VoiceAndLibrary> {
  try {
    const supabase = getSupabaseServiceClient();
    const [voiceRes, overridesRes] = await Promise.all([
      supabase.from("brand_voice_profiles").select("*").eq("organization_id", organizationId).maybeSingle(),
      supabase.from("predefined_messages").select("key, register, emoji_level, body, status").eq("organization_id", organizationId).eq("status", "approved"),
    ]);
    const voice = voiceRes.error ? DEFAULT_BRAND_VOICE : voiceFromRow(voiceRes.data as Record<string, unknown> | null);
    const overrides: LibraryOverride[] = overridesRes.error
      ? []
      : (overridesRes.data ?? []).map((r) => ({
          key: String(r.key),
          register: r.register as LibraryOverride["register"],
          emojiLevel: r.emoji_level as LibraryOverride["emojiLevel"],
          body: String(r.body),
          status: "approved" as const,
        }));
    return { voice, library: createMessageLibrary(voice, overrides) };
  } catch (error) {
    console.warn(`[voice] chargement impossible (org ${organizationId}), voix par défaut:`, error instanceof Error ? error.message : error);
    return { voice: DEFAULT_BRAND_VOICE, library: createMessageLibrary(DEFAULT_BRAND_VOICE) };
  }
}

export async function getBrandVoice(organizationId: string): Promise<BrandVoice> {
  await requireMembership(organizationId);
  return (await loadVoiceAndLibrary(organizationId)).voice;
}

/** Enregistre le profil de voix (propriétaire / administrateur). Refuse une saisie invalide au lieu de la corriger. */
export async function saveBrandVoice(organizationId: string, input: unknown): Promise<BrandVoice> {
  await requireMembership(organizationId, ["owner", "admin"]);
  const parsed = parseBrandVoiceInput(input);
  if (!parsed.ok) throw new ValidationError(`Profil de voix invalide : ${parsed.errors.join(" ; ")}`);
  const { voice } = parsed;

  const supabase = getSupabaseServiceClient();
  const { data: existing } = await supabase.from("brand_voice_profiles").select("examples_consent, examples_consent_at").eq("organization_id", organizationId).maybeSingle();
  // La date de consentement est celle du premier « oui » ; retirer le consentement efface les exemples (contrainte en base).
  const consentAt = voice.examplesConsent ? ((existing?.examples_consent && existing.examples_consent_at) || new Date().toISOString()) : null;

  const { error } = await supabase.from("brand_voice_profiles").upsert(
    {
      organization_id: organizationId,
      register: voice.register,
      emoji_level: voice.emojiLevel,
      local_expressions: voice.localExpressions,
      avoid_expressions: voice.avoidExpressions,
      example_messages: voice.examplesConsent ? voice.exampleMessages : [],
      examples_consent: voice.examplesConsent,
      examples_consent_at: consentAt,
    },
    { onConflict: "organization_id" },
  );
  if (error) throw new Error(`Erreur enregistrement voix de marque: ${error.message}`);
  return { ...voice, exampleMessages: voice.examplesConsent ? voice.exampleMessages : [] };
}

export interface SaveMessageInput {
  key: string;
  register?: "any" | Register;
  emojiLevel?: "any" | EmojiLevel;
  body: string;
}

/**
 * Le propriétaire écrit SA formulation : c'est lui le validateur, elle est donc
 * `approved` d'emblée (avec auteur et date). Les propositions du modèle (`source = 'llm'`)
 * passeront par `draft` puis une approbation explicite (étape suivante).
 */
export async function saveApprovedMessage(organizationId: string, input: SaveMessageInput): Promise<void> {
  const membership = await requireMembership(organizationId, ["owner", "admin"]);
  const register = input.register ?? "any";
  const emojiLevel = input.emojiLevel ?? "any";
  const errors = validateOverrideBody(input.key, input.body, { register, emojiLevel });
  if (errors.length > 0) throw new ValidationError(`Message invalide : ${errors.join(" ; ")}`);

  const { error } = await getSupabaseServiceClient()
    .from("predefined_messages")
    .upsert(
      {
        organization_id: organizationId,
        key: input.key,
        register,
        emoji_level: emojiLevel,
        body: input.body.trim(),
        status: "approved",
        source: "owner",
        approved_by: membership.userId,
        approved_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,key,register,emoji_level" },
    );
  if (error) throw new Error(`Erreur enregistrement message: ${error.message}`);
}

/** Retire une surcharge : le message revient à la valeur par défaut. */
export async function removeMessageOverride(organizationId: string, input: { key: string; register?: "any" | Register; emojiLevel?: "any" | EmojiLevel }): Promise<void> {
  await requireMembership(organizationId, ["owner", "admin"]);
  const { error } = await getSupabaseServiceClient()
    .from("predefined_messages")
    .delete()
    .eq("organization_id", organizationId)
    .eq("key", input.key)
    .eq("register", input.register ?? "any")
    .eq("emoji_level", input.emojiLevel ?? "any");
  if (error) throw new Error(`Erreur suppression message: ${error.message}`);
}
