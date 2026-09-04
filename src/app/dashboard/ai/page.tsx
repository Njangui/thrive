import { redirect } from "next/navigation";
import { requireCurrentOrganization, requireMembership } from "@/application/services/auth-service";
import { getAiConfig, updateAiConfig } from "@/application/services/ai-config-service";
import { AI_PROVIDER_NAMES, type AIProviderName } from "@/infrastructure/providers/registry";
import { AppError } from "@/lib/errors";
import { SubmitButton } from "@/app/_components/submit-button";

/**
 * Lot L, Partie 2. Vocabulaire non technique (cahier) : ni "provider", ni
 * "model", ni "max_tokens" ne sont affichés bruts. Le menu "Qui répond
 * aux clients" est peuplé depuis AI_PROVIDER_NAMES (registry.ts) — jamais
 * une liste dupliquée ici qui pourrait diverger.
 */

const PROVIDER_LABELS: Record<AIProviderName, string> = {
  mistral: "Mistral",
  claude: "Claude (Anthropic)",
  openai: "OpenAI",
};

const TONE_PRESETS = ["professionnel et chaleureux", "direct et efficace", "détendu et amical"];

function flashRedirect(kind: "success" | "error", message: string): never {
  redirect(`/dashboard/ai?${kind}=${encodeURIComponent(message)}`);
}

async function updateAiConfigAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);

  const objectivesRaw = String(formData.get("objectives") ?? "");
  const objectives = objectivesRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const fallbackProviderRaw = String(formData.get("fallbackProvider") ?? "");

  try {
    await updateAiConfig(
      organizationId,
      {
        enabled: formData.get("enabled") === "on",
        provider: String(formData.get("provider") ?? ""),
        fallbackProvider: fallbackProviderRaw === "" ? null : fallbackProviderRaw,
        tone: String(formData.get("tone") ?? ""),
        language: String(formData.get("language") ?? "fr"),
        objectives,
        maxTokens: Number(formData.get("maxTokens")),
        temperature: Number(formData.get("temperature")),
      },
      membership.userId,
    );
    flashRedirect("success", "Configuration de l'assistant enregistrée.");
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de l'enregistrement.";
    flashRedirect("error", message);
  }
}

export default async function AiConfigPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const { success, error } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  const config = await getAiConfig(organizationId);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Assistant IA</h1>
        <p className="mt-1 text-sm text-muted">Configurez comment l&apos;assistant répond à vos clients.</p>
      </div>

      {success && <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">{success}</p>}
      {error && <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>}

      <form action={updateAiConfigAction} className="flex flex-col gap-5 rounded-brand border border-ink/10 bg-white p-4">
        <input type="hidden" name="organizationId" value={organizationId} />

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enabled" defaultChecked={config.enabled} className="h-4 w-4" />
          Activer l&apos;assistant IA pour répondre automatiquement aux clients
        </label>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-muted" htmlFor="provider">
            Qui répond aux clients
          </label>
          <select
            id="provider"
            name="provider"
            defaultValue={config.provider}
            className="w-full rounded-brand border border-ink/15 px-3 py-2 text-sm"
          >
            {AI_PROVIDER_NAMES.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-muted" htmlFor="fallbackProvider">
            Solution de secours (si le principal est indisponible)
          </label>
          <select
            id="fallbackProvider"
            name="fallbackProvider"
            defaultValue={config.fallbackProvider ?? ""}
            className="w-full rounded-brand border border-ink/15 px-3 py-2 text-sm"
          >
            <option value="">Aucune</option>
            {AI_PROVIDER_NAMES.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-muted" htmlFor="tone">
            Ton des réponses
          </label>
          <input
            id="tone"
            name="tone"
            list="tone-presets"
            defaultValue={config.tone ?? ""}
            placeholder="ex : professionnel et chaleureux"
            className="w-full rounded-brand border border-ink/15 px-3 py-2 text-sm"
          />
          <datalist id="tone-presets">
            {TONE_PRESETS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-muted" htmlFor="objectives">
            Objectifs prioritaires (un par ligne)
          </label>
          <textarea
            id="objectives"
            name="objectives"
            rows={4}
            defaultValue={config.objectives.join("\n")}
            placeholder={"ex : mettre en avant les promotions en cours\nrépondre en moins de 2 phrases"}
            className="w-full rounded-brand border border-ink/15 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-muted" htmlFor="language">
            Langue des réponses
          </label>
          <select id="language" name="language" defaultValue={config.language} className="w-full rounded-brand border border-ink/15 px-3 py-2 text-sm">
            <option value="fr">Français</option>
            <option value="en">Anglais</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-muted" htmlFor="maxTokens">
            Longueur maximale des réponses
          </label>
          <input
            id="maxTokens"
            type="number"
            name="maxTokens"
            min={128}
            max={2048}
            step={1}
            defaultValue={config.maxTokens}
            className="w-full rounded-brand border border-ink/15 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-muted">Entre 128 (réponses courtes) et 2048 (réponses détaillées).</p>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium uppercase text-muted" htmlFor="temperature">
            Créativité des réponses
          </label>
          <input
            id="temperature"
            type="number"
            name="temperature"
            min={0}
            max={1}
            step={0.1}
            defaultValue={config.temperature}
            className="w-full rounded-brand border border-ink/15 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-muted">Entre 0 (réponses prévisibles) et 1 (réponses plus variées).</p>
        </div>

        <SubmitButton pendingLabel="Enregistrement..." className="w-fit rounded-brand bg-leaf px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
          Enregistrer
        </SubmitButton>
      </form>
    </div>
  );
}
