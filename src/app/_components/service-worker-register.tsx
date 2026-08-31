"use client";

import { useEffect } from "react";

/**
 * Enregistre le service worker minimal (public/sw.js) côté client
 * uniquement — nécessaire pour qu'un navigateur propose l'installation
 * PWA (cahier Lot E, Partie 3). Ne fait rien si l'API n'est pas
 * disponible (navigateurs anciens, contexte non sécurisé) plutôt que de
 * lever une erreur visible. Monté une seule fois dans app/layout.tsx —
 * s'applique à TOUTES les pages, y compris la vitrine publique d'un
 * tenant, jamais uniquement au dashboard.
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

/**
 * Lot I, Partie 1 — notifications push réelles. Fonctions volontairement
 * PAS auto-déclenchées au montage : `ServiceWorkerRegister` ci-dessus
 * tourne globalement (y compris sur la vitrine publique d'un tenant, pour
 * des visiteurs anonymes) — demander la permission de notification à
 * chaque chargement de page serait à la fois hors-sujet (ce sont les
 * ADMINS du dashboard qui reçoivent des notifications, jamais les
 * visiteurs du site public) et une mauvaise pratique navigateur (la
 * plupart bloquent silencieusement une demande de permission qui n'est
 * pas déclenchée par un vrai geste utilisateur). C'est le bouton du
 * toggle dans /dashboard/notifications (voir push-toggle.tsx) qui appelle
 * `subscribeToPush` depuis son gestionnaire de clic.
 */

/** Convertit une clé VAPID base64url en Uint8Array — format attendu par `pushManager.subscribe`. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

export function isPushSupportedByBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** État de souscription push RÉEL de CET appareil (pas une valeur déduite de la base de données). */
export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupportedByBrowser()) return null;
  const registration = await navigator.serviceWorker.getRegistration("/sw.js");
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

/**
 * Active les notifications push sur cet appareil : s'assure que le SW est
 * enregistré, demande la permission navigateur, puis s'abonne. À appeler
 * uniquement depuis un gestionnaire de clic (geste utilisateur explicite).
 */
export async function subscribeToPush(vapidPublicKey: string): Promise<PushSubscriptionJSON> {
  if (!isPushSupportedByBrowser()) {
    throw new Error("Les notifications push ne sont pas supportées par ce navigateur.");
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Permission refusée — activez les notifications dans les réglages du navigateur pour réessayer.");
  }

  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing.toJSON();

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  return subscription.toJSON();
}

/** Désabonne cet appareil et retourne l'endpoint désactivé (pour nettoyage côté serveur), ou null si déjà désabonné. */
export async function unsubscribeFromPush(): Promise<string | null> {
  const subscription = await getExistingPushSubscription();
  if (!subscription) return null;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  return endpoint;
}
