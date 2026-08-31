"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  submitBusinessStep,
  submitLogoStep,
  submitContactStep,
  submitProductStep,
  submitFaqStep,
  advanceOnboardingStep,
  completeOnboarding,
} from "./onboarding-actions";
import { ImageUploadField } from "@/app/_components/image-upload-field";

const TOTAL_STEPS = 6;

const INDUSTRY_OPTIONS = [
  { value: "", label: "Autre" },
  { value: "retail", label: "Commerce / Boutique" },
  { value: "restaurant", label: "Restauration" },
  { value: "beauty", label: "Beauté & bien-être" },
  { value: "professional_services", label: "Services professionnels" },
  { value: "real_estate", label: "Immobilier" },
];

const SUGGESTED_FAQS = [
  { question: "Quels sont vos horaires d'ouverture ?", answer: "" },
  { question: "Comment puis-je vous joindre ?", answer: "" },
  { question: "Livrez-vous ?", answer: "" },
];

function StepHeader({ step, title }: { step: number; title: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full ${i < step ? "bg-leaf" : "bg-ink/10"}`}
          />
        ))}
      </div>
      <p className="text-xs text-muted">Étape {step} sur {TOTAL_STEPS}</p>
      <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
    </div>
  );
}

/**
 * Assistant d'onboarding multi-étapes (Lot E, Partie 2, section 50/77).
 * Client Component avec état local (`step`) pour la navigation — les
 * Server Actions d'onboarding-actions.ts ne sont appelées qu'à la
 * soumission finale de chaque étape qui en a besoin (cahier Lot E), jamais
 * pour la navigation elle-même. Seule l'étape 1 est obligatoire ; toutes
 * les autres ont un bouton "Passer pour plus tard" qui avance sans rien
 * soumettre — aucune étape ne bloque la création du compte.
 *
 * Lot I, Partie 2 (reprise) : `initialStep`/`initialOrganizationId` sont
 * fournis par onboarding/page.tsx quand une organisation existe déjà mais
 * n'a pas terminé l'onboarding (onboarding_completed_at = null). La
 * progression est persistée à chaque étape (voir onboarding-actions.ts) et
 * "Passer pour plus tard" persiste aussi (via advanceOnboardingStep) — un
 * onboarding interrompu reprend toujours à la DERNIÈRE étape réellement
 * quittée, jamais à l'étape 1.
 */
export function OnboardingWizard({
  initialStep = 1,
  initialOrganizationId = null,
}: {
  initialStep?: number;
  initialOrganizationId?: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [organizationId, setOrganizationId] = useState<string | null>(initialOrganizationId);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Capturé une seule fois au montage : sert uniquement à afficher la
  // bannière de reprise, ne doit pas réapparaître si l'utilisateur avance
  // ensuite normalement dans le wizard pendant la même session.
  const [isResuming] = useState(initialStep > 1);

  // L'étape 6 est un état terminal, pas une simple étape "soumise" — on
  // marque l'onboarding comme terminé dès qu'elle est atteinte (montage
  // initial en reprise INCLUS, pas seulement après un clic "Continuer"),
  // pour que dashboard/layout.tsx cesse de rediriger vers /onboarding même
  // si l'utilisateur ferme l'onglet sans cliquer sur "Aller à mon tableau
  // de bord".
  useEffect(() => {
    if (step === 6 && organizationId) {
      void completeOnboarding(organizationId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, organizationId]);

  function goToDashboard() {
    router.push("/dashboard");
  }

  function handleBusinessSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const name = String(formData.get("name") ?? "");
      const industry = String(formData.get("industry") ?? "");
      const result = await submitBusinessStep(name, industry);
      if (!result.ok || !result.organizationId) {
        setError(result.error ?? "Erreur inconnue.");
        return;
      }
      setOrganizationId(result.organizationId);
      setStep(2);
    });
  }

  function handleOptionalStep(action: (organizationId: string, formData: FormData) => Promise<{ ok: boolean; error?: string }>) {
    return (formData: FormData) => {
      if (!organizationId) return;
      setError(null);
      startTransition(async () => {
        const result = await action(organizationId, formData);
        if (!result.ok) {
          setError(result.error ?? "Erreur inconnue.");
          return;
        }
        setStep((s) => s + 1);
      });
    };
  }

  const handleLogoSubmit = handleOptionalStep(submitLogoStep);
  const handleContactSubmit = handleOptionalStep(submitContactStep);
  const handleProductSubmit = handleOptionalStep(submitProductStep);
  const handleFaqSubmit = handleOptionalStep(submitFaqStep);

  /**
   * `<form action={fn}>` avec une fonction cliente ordinaire (pas une
   * vraie Server Action) n'est pas un pattern fiable sur React
   * 18.3/Next 14 — on passe par `onSubmit` + `preventDefault` +
   * `FormData` manuel, le pattern universel qui fonctionne quelle que
   * soit la version.
   */
  function onSubmitWithFormData(handler: (formData: FormData) => void) {
    return (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      handler(new FormData(event.currentTarget));
    };
  }

  function skip() {
    setError(null);
    setStep((s) => {
      const next = s + 1;
      // Fire-and-forget assumé : `advanceOnboardingStep` ne lève jamais
      // (voir onboarding-actions.ts) et la navigation locale ne doit
      // JAMAIS attendre une écriture réseau — "Passer pour plus tard"
      // doit rester instantané, c'est tout l'intérêt du bouton.
      if (organizationId) void advanceOnboardingStep(organizationId, next);
      return next;
    });
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 py-10">
      {isResuming && !error && (
        <p className="rounded-brand border border-leaf/30 bg-leaf/5 px-4 py-3 text-sm text-ink">
          Vous aviez commencé votre configuration — reprenons où vous vous étiez arrêté.
        </p>
      )}

      {error && (
        <p className="rounded-brand border border-clay/30 bg-clay/5 px-4 py-3 text-sm text-clay">{error}</p>
      )}

      {step === 1 && (
        <>
          <StepHeader step={1} title="Votre entreprise" />
          <form
            onSubmit={onSubmitWithFormData(handleBusinessSubmit)}
            className="flex flex-col gap-3"
          >
            <label className="flex flex-col gap-1 text-sm">
              Nom de l&apos;entreprise
              <input name="name" required className="rounded-brand border border-ink/15 px-4 py-3" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Activité
              <select name="industry" defaultValue="" className="rounded-brand border border-ink/15 px-4 py-3">
                {INDUSTRY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-brand bg-leaf px-4 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {isPending ? "En cours..." : "Continuer"}
            </button>
          </form>
        </>
      )}

      {step === 2 && (
        <>
          <StepHeader step={2} title="Votre logo" />
          <p className="text-sm text-muted">Optionnel — vous pourrez l&apos;ajouter plus tard depuis &quot;Mon site&quot;.</p>
          <form onSubmit={onSubmitWithFormData(handleLogoSubmit)} className="flex flex-col gap-3">
            <ImageUploadField name="logo" label="Logo" />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isPending}
                className="flex-1 rounded-brand bg-leaf px-4 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {isPending ? "En cours..." : "Continuer"}
              </button>
              <button
                type="button"
                onClick={skip}
                disabled={isPending}
                className="rounded-brand border border-ink/15 px-4 py-3 text-sm font-medium text-muted hover:bg-ink/5"
              >
                Passer pour plus tard
              </button>
            </div>
          </form>
        </>
      )}

      {step === 3 && (
        <>
          <StepHeader step={3} title="Vos coordonnées" />
          <p className="text-sm text-muted">Optionnel — utile pour que vos clients vous contactent.</p>
          <form onSubmit={onSubmitWithFormData(handleContactSubmit)} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Téléphone
              <input name="phone" placeholder="+237..." className="rounded-brand border border-ink/15 px-4 py-3" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              WhatsApp
              <input name="whatsapp" placeholder="+237..." className="rounded-brand border border-ink/15 px-4 py-3" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Adresse
              <input name="address" className="rounded-brand border border-ink/15 px-4 py-3" />
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isPending}
                className="flex-1 rounded-brand bg-leaf px-4 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {isPending ? "En cours..." : "Continuer"}
              </button>
              <button
                type="button"
                onClick={skip}
                disabled={isPending}
                className="rounded-brand border border-ink/15 px-4 py-3 text-sm font-medium text-muted hover:bg-ink/5"
              >
                Passer pour plus tard
              </button>
            </div>
          </form>
        </>
      )}

      {step === 4 && (
        <>
          <StepHeader step={4} title="Votre premier produit" />
          <p className="text-sm text-muted">Optionnel — vous pourrez en ajouter autant que nécessaire ensuite.</p>
          <form onSubmit={onSubmitWithFormData(handleProductSubmit)} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Nom du produit
              <input name="name" className="rounded-brand border border-ink/15 px-4 py-3" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Prix (FCFA)
              <input name="price" type="number" min="0" defaultValue={0} className="rounded-brand border border-ink/15 px-4 py-3" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Stock
              <input name="stock" type="number" min="0" defaultValue={0} className="rounded-brand border border-ink/15 px-4 py-3" />
            </label>
            <ImageUploadField name="image" label="Photo du produit" helpText="Optionnel." />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isPending}
                className="flex-1 rounded-brand bg-leaf px-4 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {isPending ? "En cours..." : "Continuer"}
              </button>
              <button
                type="button"
                onClick={skip}
                disabled={isPending}
                className="rounded-brand border border-ink/15 px-4 py-3 text-sm font-medium text-muted hover:bg-ink/5"
              >
                Passer pour plus tard
              </button>
            </div>
          </form>
        </>
      )}

      {step === 5 && (
        <>
          <StepHeader step={5} title="Questions fréquentes" />
          <p className="text-sm text-muted">
            Optionnel — répondez à celles qui vous concernent, laissez les autres vides.
          </p>
          <form onSubmit={onSubmitWithFormData(handleFaqSubmit)} className="flex flex-col gap-4">
            {SUGGESTED_FAQS.map((faq, i) => (
              <div key={i} className="flex flex-col gap-1">
                <input type="hidden" name={`question${i}`} defaultValue={faq.question} />
                <label className="text-sm font-medium">{faq.question}</label>
                <input
                  name={`answer${i}`}
                  placeholder="Votre réponse (laissez vide pour passer)"
                  className="rounded-brand border border-ink/15 px-4 py-3 text-sm"
                />
              </div>
            ))}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={isPending}
                className="flex-1 rounded-brand bg-leaf px-4 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {isPending ? "En cours..." : "Continuer"}
              </button>
              <button
                type="button"
                onClick={skip}
                disabled={isPending}
                className="rounded-brand border border-ink/15 px-4 py-3 text-sm font-medium text-muted hover:bg-ink/5"
              >
                Passer pour plus tard
              </button>
            </div>
          </form>
        </>
      )}

      {step === 6 && (
        <>
          <StepHeader step={6} title="C'est prêt !" />
          <p className="text-sm text-muted">
            Votre entreprise est configurée. Vous pouvez compléter les informations manquantes à tout moment depuis le tableau de bord.
          </p>
          <button
            type="button"
            onClick={goToDashboard}
            className="rounded-brand bg-leaf px-4 py-3 font-medium text-white transition-opacity hover:opacity-90"
          >
            Aller à mon tableau de bord
          </button>
        </>
      )}
    </div>
  );
}
