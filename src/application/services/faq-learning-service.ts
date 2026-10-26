import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { getTenantPublicOrigin } from "@/infrastructure/tenant/resolve-request-tenant";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { STOREFRONT_PATHS } from "@/application/config/storefront-routes";
import { requireMembership } from "./auth-service";
import { resolveBusinessInfo } from "./business-info-resolver";
import { zoneLine } from "./delivery-rules";
import { loadDeliveryRules } from "./delivery-rules-service";
import {
  addDays,
  areSimilar,
  checkFaqTemplate,
  clampThreshold,
  clusterQuestions,
  creditsSaved,
  DEFAULT_WEEKLY_THRESHOLD,
  extractFaqVariables,
  FAQ_WINDOW_DAYS,
  questionTokens,
  REJECT_COOLDOWN_DAYS,
  redactQuestion,
  renderFaqAnswer,
  REVIEW_INTERVAL_DAYS,
  suggestAnswerFrom,
  suggestKeywords,
  type LoggedQuestion,
} from "./faq-learning";

/**
 * C3 — accès base de la FAQ qui apprend (livrable F, migration 0143).
 *
 * Isolation (principe 5) : client service-role, donc chaque requête filtre sur
 * `organization_id`. Les fonctions « runtime » (enregistrer une question, un
 * usage, résoudre les variables) sont appelées par l'assistant sans utilisateur
 * et NE LÈVENT JAMAIS : l'apprentissage ne doit jamais empêcher de répondre.
 * Les fonctions « propriétaire » (réglages, validation) exigent propriétaire ou
 * administrateur du tenant.
 *
 * Rien n'est publié automatiquement : une proposition devient une FAQ seulement
 * quand le propriétaire la valide (ou la modifie).
 */

const MAX_RECENT_QUESTIONS = 500;
const MAX_CANDIDATES_SCANNED = 100;
const MAX_CANDIDATES_LISTED = 50;

export interface FaqLearningSettings {
  enabled: boolean;
  weeklyThreshold: number;
}

const DEFAULT_SETTINGS: FaqLearningSettings = { enabled: false, weeklyThreshold: DEFAULT_WEEKLY_THRESHOLD };

async function loadSettings(organizationId: string): Promise<FaqLearningSettings> {
  const { data, error } = await getSupabaseServiceClient().from("faq_learning_settings").select("enabled, weekly_threshold").eq("organization_id", organizationId).maybeSingle();
  if (error || !data) return DEFAULT_SETTINGS;
  return { enabled: data.enabled === true, weeklyThreshold: clampThreshold(Number(data.weekly_threshold)) };
}

export async function getFaqLearningSettings(organizationId: string): Promise<FaqLearningSettings> {
  await requireMembership(organizationId, ["owner", "admin"]);
  return loadSettings(organizationId);
}

/** Activer l'apprentissage = accepter que les questions des clients (nettoyées) soient conservées 30 jours pour repérer celles qui reviennent. */
export async function saveFaqLearningSettings(organizationId: string, input: { enabled: boolean; weeklyThreshold?: number }): Promise<FaqLearningSettings> {
  await requireMembership(organizationId, ["owner", "admin"]);
  const settings: FaqLearningSettings = { enabled: input.enabled === true, weeklyThreshold: clampThreshold(input.weeklyThreshold ?? DEFAULT_WEEKLY_THRESHOLD) };
  const { error } = await getSupabaseServiceClient()
    .from("faq_learning_settings")
    .upsert({ organization_id: organizationId, enabled: settings.enabled, weekly_threshold: settings.weeklyThreshold }, { onConflict: "organization_id" });
  if (error) throw new Error(`Erreur enregistrement réglages FAQ: ${error.message}`);
  return settings;
}

// ---------------------------------------------------------------------------
// Runtime : enregistrer une question et proposer une FAQ si elle revient
// ---------------------------------------------------------------------------

export interface LearningQuestionInput {
  question: string;
  /** 'ai' : l'assistant a répondu ; 'verify' : « je vérifie » + humain. */
  resolution: "ai" | "verify";
  /** Réponse envoyée (sert à pré-remplir la proposition, seulement si elle ne contient rien de périssable). */
  replyText?: string | null;
  catalogUrl: string;
}

/** Ne lève jamais. Retourne `true` si une NOUVELLE proposition a été créée. */
export async function recordQuestionForLearning(organizationId: string, input: LearningQuestionInput): Promise<boolean> {
  try {
    const settings = await loadSettings(organizationId);
    if (!settings.enabled) return false;

    const tokens = questionTokens(input.question);
    if (tokens.length === 0) return false;
    const suggestedAnswer = input.resolution === "ai" && input.replyText ? suggestAnswerFrom(input.replyText, input.catalogUrl) : null;
    const supabase = getSupabaseServiceClient();

    const { error: insertError } = await supabase.from("faq_question_log").insert({
      organization_id: organizationId,
      question: redactQuestion(input.question),
      tokens,
      resolution: input.resolution,
      suggested_answer: suggestedAnswer,
    });
    if (insertError) throw new Error(insertError.message);

    const since = addDays(new Date(), -FAQ_WINDOW_DAYS).toISOString();
    const { data: rows, error: readError } = await supabase
      .from("faq_question_log")
      .select("question, tokens, resolution, suggested_answer, created_at")
      .eq("organization_id", organizationId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(MAX_RECENT_QUESTIONS);
    if (readError) throw new Error(readError.message);

    const similar: LoggedQuestion[] = (rows ?? [])
      .map((r) => ({ question: String(r.question), tokens: (r.tokens ?? []) as string[], resolution: r.resolution as "ai" | "verify", suggestedAnswer: (r.suggested_answer as string | null) ?? null, createdAt: String(r.created_at) }))
      .filter((r) => areSimilar(tokens, r.tokens));
    if (similar.length < settings.weeklyThreshold) return false;

    const main = clusterQuestions(similar).sort((a, b) => b.members.length - a.members.length)[0];
    if (!main || main.signature.length === 0) return false;

    // Déjà proposée (en attente) ou récemment décidée ? On met à jour le compteur ou on se tait.
    const { data: existing, error: existingError } = await supabase
      .from("faq_candidates")
      .select("id, status, signature, cooldown_until, suggested_answer")
      .eq("organization_id", organizationId)
      .order("last_seen_at", { ascending: false })
      .limit(MAX_CANDIDATES_SCANNED);
    if (existingError) throw new Error(existingError.message);

    const now = new Date();
    for (const c of existing ?? []) {
      if (!areSimilar(main.signature, (c.signature ?? []) as string[])) continue;
      if (c.status === "pending") {
        const latestAnswer = main.members.filter((m) => m.suggestedAnswer).at(-1)?.suggestedAnswer ?? null;
        await supabase
          .from("faq_candidates")
          .update({ occurrences: main.members.length, last_seen_at: now.toISOString(), ...(c.suggested_answer || !latestAnswer ? {} : { suggested_answer: latestAnswer }) })
          .eq("id", c.id)
          .eq("organization_id", organizationId);
        return false;
      }
      if (c.cooldown_until && new Date(String(c.cooldown_until)) > now) return false;
    }

    const answer = [...main.members].reverse().find((m) => m.suggestedAnswer)?.suggestedAnswer ?? null;
    const { error: candidateError } = await supabase.from("faq_candidates").insert({
      organization_id: organizationId,
      question: main.representative.question,
      suggested_answer: answer,
      keywords: suggestKeywords(main.signature),
      signature: main.signature,
      occurrences: main.members.length,
    });
    if (candidateError) throw new Error(candidateError.message);
    return true;
  } catch (error) {
    console.warn(`[faq-learning] enregistrement impossible (org ${organizationId}):`, error instanceof Error ? error.message : error);
    return false;
  }
}

/** Compte un usage de FAQ (= un tour d'IA évité). Ne lève jamais ; la base refuse un faq_id d'une autre organisation. */
export async function recordFaqHit(organizationId: string, faqId: string): Promise<void> {
  try {
    const { error } = await getSupabaseServiceClient().rpc("faq_record_hit", { p_organization_id: organizationId, p_faq_id: faqId });
    if (error) throw new Error(error.message);
  } catch (error) {
    console.warn(`[faq-learning] usage non compté (org ${organizationId}):`, error instanceof Error ? error.message : error);
  }
}

// ---------------------------------------------------------------------------
// Runtime : variables dynamiques au moment de répondre
// ---------------------------------------------------------------------------

/**
 * Remplace {hours}, {address}, {contact}, {catalog_url}, {price:slug} par les valeurs ACTUELLES.
 * `null` si une valeur est introuvable (horaires non renseignés, produit supprimé ou inactif) :
 * la FAQ n'est alors pas utilisée — jamais de réponse périmée. Ne lève jamais.
 */
export async function resolveFaqAnswerVariables(organizationId: string, answer: string): Promise<string | null> {
  const variables = extractFaqVariables(answer);
  if (variables.length === 0) return answer;
  try {
    const values: Record<string, string | null> = {};
    await Promise.all(
      variables.map(async (name) => {
        if (name === "hours" || name === "address" || name === "contact") values[name] = await resolveBusinessInfo(organizationId, name);
        else if (name === "catalog_url") values[name] = `${await getTenantPublicOrigin(organizationId)}${STOREFRONT_PATHS.catalog}`;
        else if (name.startsWith("price:")) values[name] = await currentPrice(organizationId, name.slice("price:".length));
        else if (name === "delivery_zones") {
          const zones = (await loadDeliveryRules(organizationId)).zones;
          values[name] = zones.length > 0 ? zones.map((z) => z.name).join(", ") : null;
        } else if (name.startsWith("delivery:")) {
          const zone = (await loadDeliveryRules(organizationId)).zones.find((z) => z.slug === name.slice("delivery:".length));
          values[name] = zone ? zoneLine(zone) : null;
        }
        else values[name] = null;
      }),
    );
    return renderFaqAnswer(answer, values);
  } catch (error) {
    console.warn(`[faq-learning] variables non résolues (org ${organizationId}):`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function currentPrice(organizationId: string, slug: string): Promise<string | null> {
  const { data } = await getSupabaseServiceClient().from("products").select("unit_price").eq("organization_id", organizationId).eq("slug", slug).eq("status", "active").maybeSingle();
  return data ? `${Number(data.unit_price).toLocaleString("fr-FR")} FCFA` : null;
}

// ---------------------------------------------------------------------------
// Propriétaire : propositions, validation, économies, relecture
// ---------------------------------------------------------------------------

export interface FaqCandidate {
  id: string;
  question: string;
  suggestedAnswer: string | null;
  keywords: string[];
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export async function listFaqCandidates(organizationId: string): Promise<FaqCandidate[]> {
  await requireMembership(organizationId, ["owner", "admin"]);
  const { data, error } = await getSupabaseServiceClient()
    .from("faq_candidates")
    .select("id, question, suggested_answer, keywords, occurrences, first_seen_at, last_seen_at")
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .order("occurrences", { ascending: false })
    .limit(MAX_CANDIDATES_LISTED);
  if (error) throw new Error(`Erreur lecture propositions de FAQ: ${error.message}`);
  return (data ?? []).map((c) => ({
    id: String(c.id),
    question: String(c.question),
    suggestedAnswer: (c.suggested_answer as string | null) ?? null,
    keywords: (c.keywords ?? []) as string[],
    occurrences: Number(c.occurrences),
    firstSeenAt: String(c.first_seen_at),
    lastSeenAt: String(c.last_seen_at),
  }));
}

export type FaqCandidateDecision = { action: "approve"; question?: string; answer?: string; keywords?: string[] } | { action: "reject" };

/**
 * Valider (tel quel ou modifié) ou refuser. « Valider » crée la FAQ (origine « learned »,
 * relecture dans 90 jours) ; « refuser » met la proposition en sommeil 90 jours.
 * La proposition est « réservée » avant la création de la FAQ : deux clics ne créent pas deux FAQ.
 */
export async function decideFaqCandidate(organizationId: string, candidateId: string, decision: FaqCandidateDecision): Promise<{ faqId?: string; warnings: string[] }> {
  const membership = await requireMembership(organizationId, ["owner", "admin"]);
  const supabase = getSupabaseServiceClient();
  const now = new Date();

  const { data: candidate, error: readError } = await supabase
    .from("faq_candidates")
    .select("id, question, suggested_answer, keywords, status")
    .eq("id", candidateId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (readError) throw new Error(`Erreur lecture proposition: ${readError.message}`);
  if (!candidate) throw new NotFoundError("Proposition introuvable.");
  if (candidate.status !== "pending") throw new ValidationError("Cette proposition a déjà été traitée.");

  const cooldown = addDays(now, REJECT_COOLDOWN_DAYS).toISOString();

  if (decision.action === "reject") {
    const { error } = await supabase
      .from("faq_candidates")
      .update({ status: "rejected", decided_by: membership.userId, decided_at: now.toISOString(), cooldown_until: cooldown })
      .eq("id", candidateId)
      .eq("organization_id", organizationId)
      .eq("status", "pending");
    if (error) throw new Error(`Erreur refus de la proposition: ${error.message}`);
    return { warnings: [] };
  }

  const question = (decision.question ?? String(candidate.question)).trim();
  const answer = (decision.answer ?? (candidate.suggested_answer as string | null) ?? "").trim();
  const keywords = (decision.keywords ?? ((candidate.keywords ?? []) as string[])).map((k) => k.trim()).filter(Boolean);
  if (!question) throw new ValidationError("La question est requise.");
  if (!answer) throw new ValidationError("Une réponse est requise : cette proposition n'en avait pas de suggérée, rédigez-la.");
  if (keywords.length === 0) throw new ValidationError("Au moins un mot-clé est requis pour que la FAQ puisse être détectée.");
  const template = checkFaqTemplate(answer);
  if (template.errors.length > 0) throw new ValidationError(`Réponse invalide : ${template.errors.join(" ; ")}`);

  // Réservation : un seul gagnant même si deux validations arrivent ensemble.
  const { data: claimed, error: claimError } = await supabase
    .from("faq_candidates")
    .update({ status: "approved", decided_by: membership.userId, decided_at: now.toISOString(), cooldown_until: cooldown })
    .eq("id", candidateId)
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .select("id");
  if (claimError) throw new Error(`Erreur validation de la proposition: ${claimError.message}`);
  if (!claimed || claimed.length === 0) throw new ValidationError("Cette proposition a déjà été traitée.");

  const { data: faq, error: faqError } = await supabase
    .from("faqs")
    .insert({ organization_id: organizationId, question, answer, keywords, is_active: true, source: "learned", review_at: addDays(now, REVIEW_INTERVAL_DAYS).toISOString().slice(0, 10) })
    .select("id")
    .single();
  if (faqError || !faq) {
    // La FAQ n'a pas été créée : la proposition redevient disponible.
    await supabase.from("faq_candidates").update({ status: "pending", decided_by: null, decided_at: null, cooldown_until: null }).eq("id", candidateId).eq("organization_id", organizationId);
    throw new Error(`Impossible de créer la FAQ: ${faqError?.message}`);
  }
  await supabase.from("faq_candidates").update({ faq_id: faq.id }).eq("id", candidateId).eq("organization_id", organizationId);
  return { faqId: String(faq.id), warnings: template.warnings };
}

export interface FaqSavings {
  days: number;
  faqAnswers: number;
  /** Tours d'IA évités × crédits par tour (voir CREDITS_PER_AI_TURN). */
  creditsSaved: number;
}

/** Réponses servies par les FAQ sur la période, donc crédits IA non consommés. */
export async function getFaqSavings(organizationId: string, days = 30): Promise<FaqSavings> {
  await requireMembership(organizationId);
  const since = addDays(new Date(), -Math.max(1, Math.trunc(days))).toISOString().slice(0, 10);
  const { data, error } = await getSupabaseServiceClient().from("faq_hit_daily").select("hits").eq("organization_id", organizationId).gte("day", since);
  if (error) throw new Error(`Erreur lecture économies FAQ: ${error.message}`);
  const faqAnswers = (data ?? []).reduce((sum, r) => sum + Number(r.hits), 0);
  return { days, faqAnswers, creditsSaved: creditsSaved(faqAnswers) };
}

export interface FaqDueForReview {
  id: string;
  question: string;
  reviewAt: string;
  source: "owner" | "learned";
}

/** FAQ actives dont la date de relecture est atteinte (les réponses périment : prix, horaires, règles). */
export async function listFaqsDueForReview(organizationId: string, today: Date = new Date()): Promise<FaqDueForReview[]> {
  await requireMembership(organizationId, ["owner", "admin"]);
  const { data, error } = await getSupabaseServiceClient()
    .from("faqs")
    .select("id, question, review_at, source")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .not("review_at", "is", null)
    .lte("review_at", today.toISOString().slice(0, 10))
    .order("review_at", { ascending: true });
  if (error) throw new Error(`Erreur lecture FAQ à relire: ${error.message}`);
  return (data ?? []).map((f) => ({ id: String(f.id), question: String(f.question), reviewAt: String(f.review_at), source: f.source === "learned" ? "learned" : "owner" }));
}

/** « J'ai relu cette réponse » : la prochaine relecture est dans 90 jours. */
export async function markFaqReviewed(organizationId: string, faqId: string, today: Date = new Date()): Promise<void> {
  await requireMembership(organizationId, ["owner", "admin"]);
  const { error, count } = await getSupabaseServiceClient()
    .from("faqs")
    .update({ review_at: addDays(today, REVIEW_INTERVAL_DAYS).toISOString().slice(0, 10) }, { count: "exact" })
    .eq("id", faqId)
    .eq("organization_id", organizationId);
  if (error) throw new Error(`Erreur mise à jour de la relecture: ${error.message}`);
  if (!count) throw new NotFoundError("FAQ introuvable.");
}
