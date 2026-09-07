"use client";

import { useEffect } from "react";

/**
 * Error boundary racine — capte toute erreur non gérée qui remonte
 * jusqu'ici (obligatoirement un composant client, contrainte Next.js App
 * Router). Sans ce fichier, l'écran d'erreur générique de Next.js
 * s'affichait, montrant potentiellement des détails techniques à un
 * client final (section 66 du master prompt : jamais "Something went
 * wrong" brut). Le détail technique reste dans les logs serveur/navigateur
 * (`console.error`), jamais affiché à l'écran.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Erreur non gérée (error boundary racine) :", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-5 text-center">
      <h1 className="font-display text-2xl font-bold tracking-tight">Une erreur est survenue</h1>
      <p className="text-sm text-muted">
        Quelque chose s&apos;est mal passé. Réessayez, ou revenez plus tard si le problème persiste.
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-brand bg-leaf px-4 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
      >
        Réessayer
      </button>
    </main>
  );
}
