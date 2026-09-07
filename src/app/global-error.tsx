"use client";

import { useEffect } from "react";

/**
 * Complément de error.tsx : celui-ci ne capte QUE les erreurs des routes,
 * pas une erreur dans `layout.tsx` lui-même. Next.js exige que ce fichier
 * rende son propre <html>/<body> (il remplace tout le layout racine le
 * temps de l'erreur) — obligatoirement minimal, sans dépendance au reste
 * de l'app qui vient justement de planter.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Erreur non gérée (root layout) :", error);
  }, [error]);

  return (
    <html lang="fr">
      <body style={{ fontFamily: "system-ui, sans-serif" }}>
        <main style={{ display: "flex", minHeight: "100vh", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 20, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 700 }}>Une erreur est survenue</h1>
          <p style={{ fontSize: 14, color: "#666" }}>
            Quelque chose s&apos;est mal passé au chargement de la page. Réessayez, ou revenez plus tard.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{ borderRadius: 8, background: "#166534", color: "white", padding: "12px 16px", fontSize: 14, fontWeight: 500, border: "none", cursor: "pointer" }}
          >
            Réessayer
          </button>
        </main>
      </body>
    </html>
  );
}
