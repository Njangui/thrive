"use server";

import { revalidatePath } from "next/cache";
import { requireDashboardActor } from "@/application/channels/dashboard-actor";
import { getAgentKernel } from "@/application/agents/kernel";
import { saveAssistantSettings, type SettingsFormInput } from "@/application/agents/settings-service";
import { SupabaseAgentSettingsRepository } from "@/infrastructure/agents/supabase-agent-repositories";
import { AppError } from "@/lib/errors";

export type SettingsState = { ok?: boolean; error?: string };

/** L'acteur vient TOUJOURS de la session ; le rôle est revérifié dans le service. */
export async function saveAssistantSettingsAction(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  try {
    const actor = await requireDashboardActor();
    const tools: SettingsFormInput["tools"] = {};
    for (const [key, value] of formData.entries()) {
      if (typeof value !== "string") continue;
      if (key.startsWith("mode:")) tools[key.slice(5)] = { ...(tools[key.slice(5)] ?? { mode: "" }), mode: value };
      if (key.startsWith("max:")) tools[key.slice(4)] = { ...(tools[key.slice(4)] ?? { mode: "" }), max: value };
    }
    const { kernel } = getAgentKernel();
    await saveAssistantSettings(
      { repo: new SupabaseAgentSettingsRepository(), tools: kernel.registry.list() },
      actor,
      { profile: String(formData.get("profile") ?? ""), tools },
    );
    revalidatePath("/dashboard/assistant/settings");
    return { ok: true };
  } catch (e) {
    console.error("[assistant] enregistrement des réglages impossible:", e);
    return { error: e instanceof AppError ? e.message : "Impossible d'enregistrer les réglages." };
  }
}
