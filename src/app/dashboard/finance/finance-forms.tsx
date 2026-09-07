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
      <form action={createRevenueAction} className="flex flex-col gap-2 rounded-brand border border-ink/10 bg-white p-4">
        <input type="hidden" name="organizationId" value={organizationId} />
        <p className="text-sm font-medium text-leaf">+ Revenu</p>
        <input name="amount" type="number" min="0" required placeholder="Montant" className="rounded-brand border border-ink/15 px-3 py-2 text-sm" />
        <input name="category" placeholder="Catégorie (optionnel)" className="rounded-brand border border-ink/15 px-3 py-2 text-sm" />
        <input name="note" placeholder="Note (optionnel)" className="rounded-brand border border-ink/15 px-3 py-2 text-sm" />
        <SubmitButton
          pendingLabel="Enregistrement..."
          className="w-fit rounded-brand bg-leaf px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          Enregistrer
        </SubmitButton>
      </form>

      <form action={createExpenseAction} className="flex flex-col gap-2 rounded-brand border border-ink/10 bg-white p-4">
        <input type="hidden" name="organizationId" value={organizationId} />
        <p className="text-sm font-medium text-clay">+ Dépense</p>
        <input name="amount" type="number" min="0" required placeholder="Montant" className="rounded-brand border border-ink/15 px-3 py-2 text-sm" />
        <input name="category" placeholder="Ex : transport, loyer..." className="rounded-brand border border-ink/15 px-3 py-2 text-sm" />
        <input name="description" placeholder="Description (optionnel)" className="rounded-brand border border-ink/15 px-3 py-2 text-sm" />
        <SubmitButton
          pendingLabel="Enregistrement..."
          className="w-fit rounded-brand bg-clay px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          Enregistrer
        </SubmitButton>
      </form>
    </div>
  );
}
