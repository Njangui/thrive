import { SubmitButton } from "@/app/_components/submit-button";

/**
 * Ajout Lot E, Partie 4 (audit) : les deux formulaires n'avaient ni état
 * de chargement ni retour de succès visible. `SubmitButton` couvre le
 * chargement ; le succès est géré par la page parente via `?success=`
 * (comme pour les autres écrans du Lot E) — voir finance/page.tsx.
 *
 * OPTIMISATION : ce fichier portait un `"use client"` qui n'était pas
 * nécessaire — seul `SubmitButton` (déjà "use client" pour son
 * `useFormStatus()`) a besoin d'exécuter côté navigateur. Un composant
 * qui se contente de rendre des `<form action={...}>` avec des Server
 * Actions passées en props peut rester un Server Component même si l'un
 * de ses enfants est client — retirer ce `"use client"` réduit le JS
 * envoyé au navigateur pour cet écran sans rien changer au comportement
 * (le bouton de soumission reste interactif via son propre composant).
 */
export function FinanceForms({
  organizationId,
  createRevenueAction,
  createExpenseAction,
}: {
  organizationId: string;
  createRevenueAction: (formData: FormData) => void;
  createExpenseAction: (formData: FormData) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <form action={createRevenueAction} className="flex flex-col gap-2 rounded-2xl border border-navy-900/[0.06] bg-white shadow-[0_1px_2px_rgba(16,23,49,0.04)] p-4">
        <input type="hidden" name="organizationId" value={organizationId} />
        <p className="text-sm font-medium text-success-600">+ Revenu</p>
        <input name="amount" type="number" min="0" required placeholder="Montant" className="rounded-xl border border-navy-900/10 px-3 py-2 text-sm" />
        <input name="category" placeholder="Catégorie (optionnel)" className="rounded-xl border border-navy-900/10 px-3 py-2 text-sm" />
        <input name="note" placeholder="Note (optionnel)" className="rounded-xl border border-navy-900/10 px-3 py-2 text-sm" />
        <SubmitButton
          pendingLabel="Enregistrement..."
          className="w-fit rounded-xl bg-success-600 px-4 py-2 text-sm font-medium text-white hover:bg-success-700 disabled:opacity-60"
        >
          Enregistrer
        </SubmitButton>
      </form>

      <form action={createExpenseAction} className="flex flex-col gap-2 rounded-2xl border border-navy-900/[0.06] bg-white shadow-[0_1px_2px_rgba(16,23,49,0.04)] p-4">
        <input type="hidden" name="organizationId" value={organizationId} />
        <p className="text-sm font-medium text-danger-600">+ Dépense</p>
        <input name="amount" type="number" min="0" required placeholder="Montant" className="rounded-xl border border-navy-900/10 px-3 py-2 text-sm" />
        <input name="category" placeholder="Ex : transport, loyer..." className="rounded-xl border border-navy-900/10 px-3 py-2 text-sm" />
        <input name="description" placeholder="Description (optionnel)" className="rounded-xl border border-navy-900/10 px-3 py-2 text-sm" />
        <SubmitButton
          pendingLabel="Enregistrement..."
          className="w-fit rounded-xl bg-danger-600 px-4 py-2 text-sm font-medium text-white hover:bg-danger-700 disabled:opacity-60"
        >
          Enregistrer
        </SubmitButton>
      </form>
    </div>
  );
}
