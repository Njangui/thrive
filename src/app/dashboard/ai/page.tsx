import { redirect } from "next/navigation";
import { requireCurrentOrganization, requireMembership } from "@/application/services/auth-service";
import { getAiConfig, updateAiConfig } from "@/application/services/ai-config-service";
import { AppError } from "@/lib/errors";
import { SubmitButton } from "@/app/_components/submit-button";

const MODES = {
  balanced: { label: "Équilibré", description: "Bon compromis entre rapidité, coût et qualité.", provider: "mistral", fallback: "openai" },
  fast: { label: "Rapide", description: "Réponses courtes et rapides pour les demandes simples.", provider: "openai", fallback: "mistral" },
  advanced: { label: "Avancé", description: "Réponses plus élaborées pour les échanges complexes.", provider: "claude", fallback: "mistral" },
} as const;

function modeFromProvider(provider: string) {
  return (Object.entries(MODES).find(([, value]) => value.provider === provider)?.[0] ?? "balanced") as keyof typeof MODES;
}
function flashRedirect(kind: "success" | "error", message: string): never { redirect(`/dashboard/ai?${kind}=${encodeURIComponent(message)}`); }

async function updateAiConfigAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  const membership = await requireMembership(organizationId, ["owner", "admin"]);
  const mode = String(formData.get("mode") ?? "balanced") as keyof typeof MODES;
  const selected = MODES[mode] ?? MODES.balanced;
  const length = String(formData.get("length") ?? "standard");
  const creativity = String(formData.get("creativity") ?? "natural");
  const lengthMap: Record<string, number> = { short: 320, standard: 640, detailed: 1200 };
  const tempMap: Record<string, number> = { precise: 0.1, natural: 0.35, creative: 0.65 };
  const objectives = String(formData.get("objectives") ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  try {
    await updateAiConfig(organizationId, { enabled: formData.get("enabled") === "on", provider: selected.provider, fallbackProvider: selected.fallback, tone: String(formData.get("tone") ?? "professionnel et chaleureux"), language: String(formData.get("language") ?? "fr"), objectives, maxTokens: lengthMap[length] ?? 640, temperature: tempMap[creativity] ?? 0.35 }, membership.userId);
    flashRedirect("success", "Assistant enregistré.");
  } catch (error) { flashRedirect("error", error instanceof AppError ? error.message : "Erreur lors de l'enregistrement."); }
}

export default async function AiConfigPage({ searchParams }: { searchParams: Promise<{ success?: string; error?: string }> }) {
  const { success, error } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  const config = await getAiConfig(organizationId);
  const mode = modeFromProvider(config.provider);
  const currentLength = config.maxTokens <= 400 ? "short" : config.maxTokens >= 1000 ? "detailed" : "standard";
  const currentCreativity = config.temperature <= 0.2 ? "precise" : config.temperature >= 0.55 ? "creative" : "natural";

  return (
    <div className="flex flex-col gap-6">
      <header className="relative overflow-hidden rounded-3xl bg-navy-900 p-6 text-white sm:p-8"><div className="absolute -right-20 -top-20 h-56 w-56 rounded-full bg-violet-500/25 blur-3xl"/><div className="relative"><p className="adm-eyebrow text-violet-300">Assistant</p><h1 className="mt-2 font-jakarta text-2xl font-extrabold sm:text-3xl">Votre assistant travaille pour vous.</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-white/60">Choisissez simplement le comportement souhaité. Les services utilisés en arrière-plan restent invisibles.</p></div></header>
      {success ? <p className="adm-alert-success">{success}</p> : null}{error ? <p className="adm-alert-danger">{error}</p> : null}
      <form action={updateAiConfigAction} className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]"><input type="hidden" name="organizationId" value={organizationId}/>
        <section className="adm-card space-y-5">
          <div><h2 className="adm-heading-2 text-lg">Comportement</h2><p className="mt-1 text-sm text-slate-500">CRESYVA utilise automatiquement une solution de secours si nécessaire.</p></div>
          <label className="flex items-center gap-3 rounded-2xl bg-violet-50 p-4 text-sm font-semibold"><input type="checkbox" name="enabled" defaultChecked={config.enabled} className="h-4 w-4"/> Activer les réponses automatiques</label>
          <div className="grid gap-3 sm:grid-cols-3">{Object.entries(MODES).map(([key, value]) => <label key={key} className={`cursor-pointer rounded-2xl border p-4 transition ${mode === key ? "border-violet-400 bg-violet-50 ring-2 ring-violet-100" : "border-navy-900/10 bg-white hover:border-violet-200"}`}><input type="radio" name="mode" value={key} defaultChecked={mode === key} className="sr-only"/><p className="text-sm font-bold">{value.label}</p><p className="mt-1 text-xs leading-5 text-slate-500">{value.description}</p></label>)}</div>
          <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-semibold">Longueur<select name="length" defaultValue={currentLength} className="mt-2 w-full rounded-xl border border-navy-900/10 px-3 py-3 text-sm font-normal"><option value="short">Courte</option><option value="standard">Standard</option><option value="detailed">Détaillée</option></select></label><label className="text-sm font-semibold">Style<select name="creativity" defaultValue={currentCreativity} className="mt-2 w-full rounded-xl border border-navy-900/10 px-3 py-3 text-sm font-normal"><option value="precise">Très précis</option><option value="natural">Naturel</option><option value="creative">Plus créatif</option></select></label></div>
          <label className="block text-sm font-semibold">Ton<select name="tone" defaultValue={config.tone ?? "professionnel et chaleureux"} className="mt-2 w-full rounded-xl border border-navy-900/10 px-3 py-3 text-sm font-normal"><option>professionnel et chaleureux</option><option>direct et efficace</option><option>détendu et amical</option></select></label>
        </section>
        <section className="adm-card space-y-5"><div><h2 className="adm-heading-2 text-lg">Ce que l&apos;assistant doit privilégier</h2><p className="mt-1 text-sm text-slate-500">Une règle par ligne. Ces objectifs servent à cadrer les réponses.</p></div><textarea name="objectives" rows={7} defaultValue={config.objectives.join("\n")} placeholder={"Présenter les produits disponibles\nProposer une prochaine étape claire\nTransférer à un humain si la demande est complexe"} className="w-full rounded-2xl border border-navy-900/10 px-4 py-3 text-sm leading-6"/><label className="text-sm font-semibold">Langue<select name="language" defaultValue={config.language} className="mt-2 w-full rounded-xl border border-navy-900/10 px-3 py-3 text-sm font-normal"><option value="fr">Français</option><option value="en">Anglais</option></select></label><div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-xs leading-5 text-emerald-800"><strong>Principe :</strong> l&apos;assistant utilise d&apos;abord les informations réelles de votre entreprise, votre catalogue et vos règles. Il ne doit pas inventer un prix, un stock ou une disponibilité.</div><SubmitButton pendingLabel="Enregistrement…" className="adm-btn-primary w-full">Enregistrer mon assistant</SubmitButton></section>
      </form>
    </div>
  );
}
