"use client";

import { useEffect } from "react";

/**
 * Enregistre le service worker minimal (public/sw.js) côté client
 * uniquement — nécessaire pour qu'un navigateur propose l'installation
 * PWA (cahier Lot E, Partie 3). Ne fait rien si l'API n'est pas
 * disponible (navigateurs anciens, contexte non sécurisé) plutôt que de
 * lever une erreur visible.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Échec silencieux : l'app reste pleinement fonctionnelle sans SW
      // (section 53 — pas de promesse offline, donc pas de régression si
      // l'enregistrement échoue).
    });
  }, []);

  return null;
}
