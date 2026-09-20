import { redirect } from "next/navigation";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import { listFaqs, createFaq, updateFaq, deleteFaq } from "@/application/services/faq-resolver";
import { AppError } from "@/lib/errors";

function parseKeywords(raw: string): string[] {
  // Virgules, points-virgules et retours à la ligne acceptés ; doublons et
  // entrées vides écartés (un mot-clé vide ne doit jamais être enregistré).
  const seen = new Set<string>();
  return raw
    .split(/[,;\n]/)
    .map((k) => k.trim())
    .filter((k) => {
      const key = k.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function createFaqAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);

  try {
    await createFaq({
      organizationId,
      question: String(formData.get("question") ?? ""),
      answer: String(formData.get("answer") ?? ""),
      keywords: parseKeywords(String(formData.get("keywords") ?? "")),
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la création de la FAQ";
    redirect(`/dashboard/faq?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/faq?success=" + encodeURIComponent("FAQ créée."));
}

async function updateFaqAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);
  const faqId = String(formData.get("faqId") ?? "");

  try {
    await updateFaq(organizationId, faqId, {
      question: String(formData.get("question") ?? ""),
      answer: String(formData.get("answer") ?? ""),
      keywords: parseKeywords(String(formData.get("keywords") ?? "")),
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la modification de la FAQ";
    redirect(`/dashboard/faq?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/faq?success=" + encodeURIComponent("FAQ modifiée."));
}

async function toggleFaqActiveAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);
  const faqId = String(formData.get("faqId") ?? "");
  const isActive = formData.get("isActive") === "true";

  try {
    await updateFaq(organizationId, faqId, { isActive: !isActive });
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la mise à jour";
    redirect(`/dashboard/faq?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/faq");
}

async function deleteFaqAction(formData: FormData) {
  "use server";
  const organizationId = String(formData.get("organizationId") ?? "");
  await requireMembership(organizationId, ["owner", "admin", "manager"]);
  const faqId = String(formData.get("faqId") ?? "");

  try {
    await deleteFaq(organizationId, faqId);
  } catch (error) {
    const message = error instanceof AppError ? error.message : "Erreur lors de la suppression";
    redirect(`/dashboard/faq?error=${encodeURIComponent(message)}`);
  }

  redirect("/dashboard/faq?success=" + encodeURIComponent("FAQ supprimée."));
}

export default async function FaqPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; success?: string }>;
}) {
  const { error, success } = await searchParams;
  const { organizationId } = await requireCurrentOrganization();
  const faqs = await listFaqs(organizationId);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-jakarta text-2xl font-bold tracking-tight">FAQ</h1>
      <p className="text-sm text-slate-500">
        Vos réponses aux questions fréquentes sont utilisées automatiquement (WhatsApp, Telegram) EN PRIORITÉ sur l&apos;IA
        — plus rapide, gratuit, et toujours exact. Les mots-clés déterminent quand une FAQ se déclenche : les variantes proches
        (livraison / livrez / livrer) sont reconnues, mais listez quand même les termes que vos clients utilisent vraiment.
      </p>

      {error && <p className="adm-alert-danger">{error}</p>}
      {success && (
        <p className="adm-alert-success">{success}</p>
      )}

      <section>
        <h2 className="font-jakarta text-lg font-semibold">Ajouter une FAQ</h2>
        <form
          action={createFaqAction}
          className="mt-3 flex flex-col gap-3 rounded-2xl border border-navy-900/[0.06] bg-white shadow-[0_1px_2px_rgba(16,23,49,0.04)] p-4"
        >
          <input type="hidden" name="organizationId" value={organizationId} />
          <label className="flex flex-col text-sm">
            Question
            <input name="question" required placeholder="Ex : Livrez-vous à domicile ?" className="mt-1 rounded-xl border border-navy-900/10 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col text-sm">
            Réponse
            <textarea name="answer" required rows={3} className="mt-1 rounded-xl border border-navy-900/10 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col text-sm">
            Mots-clés déclencheurs (séparés par des virgules)
            <input
              name="keywords"
              required
              placeholder="Ex : livraison, livrer, livre"
              className="mt-1 rounded-xl border border-navy-900/10 px-3 py-2 text-sm"
            />
            <span className="mt-1 text-xs text-slate-500">
              Un client écrivant l&apos;un de ces mots (ou une variante proche) recevra directement cette réponse, sans passer par l&apos;IA.
              Une expression comme « mode de paiement » exige la présence de tous ses mots.
            </span>
          </label>
          <div>
            <button type="submit" className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-medium text-white">
              Créer la FAQ
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="font-jakarta text-lg font-semibold">Vos FAQ ({faqs.length})</h2>
        <div className="mt-3 flex flex-col gap-3">
          {faqs.length === 0 ? (
            <p className="rounded-2xl border border-navy-900/[0.06] bg-white shadow-[0_1px_2px_rgba(16,23,49,0.04)] p-6 text-sm text-slate-500">
              Aucune FAQ pour l&apos;instant. Ajoutez les questions les plus fréquentes de vos clients pour que
              l&apos;assistant y réponde instantanément.
            </p>
          ) : (
            faqs.map((f) => (
              <div key={f.id} className="rounded-2xl border border-navy-900/[0.06] bg-white shadow-[0_1px_2px_rgba(16,23,49,0.04)] p-4">
                <form action={updateFaqAction} className="flex flex-col gap-3">
                  <input type="hidden" name="organizationId" value={organizationId} />
                  <input type="hidden" name="faqId" value={f.id} />
                  <div className="flex items-start justify-between gap-4">
                    <label className="flex flex-1 flex-col text-sm">
                      Question
                      <input
                        name="question"
                        required
                        defaultValue={f.question}
                        className="mt-1 rounded-xl border border-navy-900/10 px-3 py-2 text-sm"
                      />
                    </label>
                    <span
                      className={`mt-6 shrink-0 rounded-full px-2 py-0.5 text-xs ${
                        f.isActive ? "bg-success-50 text-success-700" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {f.isActive ? "Active" : "Désactivée"}
                    </span>
                  </div>
                  <label className="flex flex-col text-sm">
                    Réponse
                    <textarea
                      name="answer"
                      required
                      rows={3}
                      defaultValue={f.answer}
                      className="mt-1 rounded-xl border border-navy-900/10 px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="flex flex-col text-sm">
                    Mots-clés déclencheurs (séparés par des virgules)
                    <input
                      name="keywords"
                      required
                      defaultValue={f.keywords.join(", ")}
                      className="mt-1 rounded-xl border border-navy-900/10 px-3 py-2 text-sm"
                    />
                  </label>
                  <div className="flex items-center gap-3">
                    <button type="submit" className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-medium text-white">
                      Enregistrer les modifications
                    </button>
                  </div>
                </form>
                <div className="mt-3 flex items-center gap-3">
                  <form action={toggleFaqActiveAction}>
                    <input type="hidden" name="organizationId" value={organizationId} />
                    <input type="hidden" name="faqId" value={f.id} />
                    <input type="hidden" name="isActive" value={String(f.isActive)} />
                    <button type="submit" className="text-xs font-medium text-violet-600 hover:underline">
                      {f.isActive ? "Désactiver" : "Activer"}
                    </button>
                  </form>
                  <form action={deleteFaqAction}>
                    <input type="hidden" name="organizationId" value={organizationId} />
                    <input type="hidden" name="faqId" value={f.id} />
                    <button type="submit" className="text-xs text-danger-600 hover:underline">
                      Supprimer
                    </button>
                  </form>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
