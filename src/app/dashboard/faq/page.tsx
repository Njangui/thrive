import { redirect } from "next/navigation";
import { requireMembership, requireCurrentOrganization } from "@/application/services/auth-service";
import { listFaqs, createFaq, updateFaq, deleteFaq } from "@/application/services/faq-resolver";
import { AppError } from "@/lib/errors";

function parseKeywords(raw: string): string[] {
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
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
      <h1 className="font-display text-2xl font-bold tracking-tight">FAQ</h1>
      <p className="text-sm text-muted">
        Vos réponses aux questions fréquentes sont utilisées par l&apos;assistant WhatsApp EN PRIORITÉ sur l&apos;IA
        — plus rapide, gratuit, et toujours exact. Les mots-clés déterminent quand une FAQ se déclenche.
      </p>

      {error && <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>}
      {success && (
        <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-leaf">{success}</p>
      )}

      <section>
        <h2 className="font-display text-lg font-semibold">Ajouter une FAQ</h2>
        <form
          action={createFaqAction}
          className="mt-3 flex flex-col gap-3 rounded-brand border border-ink/10 bg-white p-4"
        >
          <input type="hidden" name="organizationId" value={organizationId} />
          <label className="flex flex-col text-sm">
            Question
            <input name="question" required placeholder="Ex : Livrez-vous à domicile ?" className="mt-1 rounded-brand border border-ink/15 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col text-sm">
            Réponse
            <textarea name="answer" required rows={3} className="mt-1 rounded-brand border border-ink/15 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col text-sm">
            Mots-clés déclencheurs (séparés par des virgules)
            <input
              name="keywords"
              required
              placeholder="Ex : livraison, livrer, livre"
              className="mt-1 rounded-brand border border-ink/15 px-3 py-2 text-sm"
            />
            <span className="mt-1 text-xs text-muted">
              Un client écrivant l&apos;un de ces mots recevra directement cette réponse, sans passer par l&apos;IA.
            </span>
          </label>
          <div>
            <button type="submit" className="rounded-brand bg-leaf px-4 py-2 text-xs font-medium text-white">
              Créer la FAQ
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold">Vos FAQ ({faqs.length})</h2>
        <div className="mt-3 flex flex-col gap-3">
          {faqs.length === 0 ? (
            <p className="rounded-brand border border-ink/10 bg-white p-6 text-sm text-muted">
              Aucune FAQ pour l&apos;instant. Ajoutez les questions les plus fréquentes de vos clients pour que
              l&apos;assistant y réponde instantanément.
            </p>
          ) : (
            faqs.map((f) => (
              <div key={f.id} className="rounded-brand border border-ink/10 bg-white p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-ink">{f.question}</p>
                    <p className="mt-1 text-sm text-muted">{f.answer}</p>
                    <p className="mt-2 text-xs text-muted">
                      Mots-clés : <span className="font-mono">{f.keywords.join(", ")}</span>
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                      f.isActive ? "bg-leaf/10 text-leaf" : "bg-ink/10 text-muted"
                    }`}
                  >
                    {f.isActive ? "Active" : "Désactivée"}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <form action={toggleFaqActiveAction}>
                    <input type="hidden" name="organizationId" value={organizationId} />
                    <input type="hidden" name="faqId" value={f.id} />
                    <input type="hidden" name="isActive" value={String(f.isActive)} />
                    <button type="submit" className="text-xs font-medium text-leaf hover:underline">
                      {f.isActive ? "Désactiver" : "Activer"}
                    </button>
                  </form>
                  <form action={deleteFaqAction}>
                    <input type="hidden" name="organizationId" value={organizationId} />
                    <input type="hidden" name="faqId" value={f.id} />
                    <button type="submit" className="text-xs text-clay hover:underline">
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
