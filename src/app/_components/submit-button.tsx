"use client";

import { useFormStatus } from "react-dom";

/**
 * Bouton de soumission avec état de chargement visible (désactivé +
 * texte "En cours...") — cahier Lot E, Partie 4 : "pour chaque action
 * réseau ... vérifiez qu'il y a : état de chargement". `useFormStatus`
 * ne fonctionne que rendu À L'INTÉRIEUR du `<form action={...}>` qu'il
 * observe (contrainte React) — d'où un composant séparé plutôt qu'un
 * simple attribut sur le bouton existant.
 */
export function SubmitButton({
  children,
  pendingLabel = "En cours...",
  disabled = false,
  className = "rounded-xl bg-violet-600 px-4 py-3 font-medium text-white shadow-[0_10px_24px_-8px_rgba(91,33,229,0.45)] transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none",
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  /** Désactivation liée à une règle métier (ex: conversation clôturée), indépendante de l'état de soumission. */
  disabled?: boolean;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending || disabled} className={className}>
      {pending ? pendingLabel : children}
    </button>
  );
}
