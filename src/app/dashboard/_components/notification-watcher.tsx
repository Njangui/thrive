"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Notifications EN DIRECT dans le dashboard ouvert : son + toast + badge à
 * jour, sans dépendre du push navigateur.
 *
 * Pourquoi : avant ce composant, une notification créée pendant que le
 * dashboard était ouvert n'apparaissait qu'à la prochaine navigation, et
 * ne faisait AUCUN bruit tant que le push n'était pas activé sur l'appareil
 * (et jamais pour les priorités « normal »). Le commerçant devait ouvrir la
 * page Notifications pour découvrir ce qui était arrivé.
 *
 * Fonctionnement : interrogation légère (`/api/notifications/unread`) toutes
 * les 20 s tant que l'onglet est visible, plus une vérification immédiate au
 * retour sur l'onglet. Quand la dernière notification non lue change,
 * on joue un carillon, on affiche un toast cliquable et on rafraîchit les
 * composants serveur (badge de la cloche). Onglet masqué => on s'appuie sur
 * le push (service worker).
 */

const SOUND_PREF_KEY = "tokoo :notification-sound";
const POLL_INTERVAL_MS = 20_000;
const TOAST_DURATION_MS = 8_000;

interface LatestNotification {
  id: string;
  title: string;
  body: string;
  url: string | null;
  createdAt: string;
}

interface UnreadResponse {
  count: number;
  latest: LatestNotification | null;
}

export function isNotificationSoundEnabled(): boolean {
  try {
    return window.localStorage.getItem(SOUND_PREF_KEY) !== "off";
  } catch {
    return true; // stockage indisponible (navigation privée...) : son activé par défaut
  }
}

export function setNotificationSoundEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(SOUND_PREF_KEY, enabled ? "on" : "off");
  } catch {
    /* préférence non persistée — sans conséquence */
  }
}

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  audioContext = new Ctor();
  return audioContext;
}

/** Carillon à deux notes synthétisé (aucun fichier audio à héberger ni à précharger). */
export function playNotificationChime(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    void ctx.resume();
    const start = ctx.currentTime + 0.02;
    [
      { freq: 880, at: 0 },
      { freq: 1318.5, at: 0.16 },
    ].forEach(({ freq, at }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start + at);
      gain.gain.exponentialRampToValueAtTime(0.35, start + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + at + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + at);
      osc.stop(start + at + 0.55);
    });
  } catch {
    /* audio bloqué par le navigateur (pas encore de geste utilisateur) — le toast reste affiché */
  }
}

export function NotificationWatcher() {
  const router = useRouter();
  const lastSeenIdRef = useRef<string | null | undefined>(undefined); // undefined = pas encore initialisé
  const [toast, setToast] = useState<LatestNotification | null>(null);

  // Les navigateurs n'autorisent l'audio qu'après un geste utilisateur :
  // on "déverrouille" le contexte audio au premier clic/touche/tap.
  useEffect(() => {
    const unlock = () => {
      try {
        void getAudioContext()?.resume();
      } catch {
        /* ignoré */
      }
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/unread", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return;
      const data = (await res.json()) as UnreadResponse;
      const latestId = data.latest?.id ?? null;

      // Première lecture : simple point de départ, jamais de son pour l'existant.
      if (lastSeenIdRef.current === undefined) {
        lastSeenIdRef.current = latestId;
        return;
      }

      if (data.latest && latestId !== lastSeenIdRef.current) {
        lastSeenIdRef.current = latestId;
        if (isNotificationSoundEnabled()) playNotificationChime();
        setToast(data.latest);
        router.refresh(); // met à jour le badge de la cloche et les listes affichées
      } else if (!data.latest) {
        lastSeenIdRef.current = null; // tout a été lu
      }
    } catch {
      /* réseau indisponible : on réessaiera au prochain cycle */
    }
  }, [router]);

  useEffect(() => {
    void check();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-3 sm:justify-end sm:px-6" role="status" aria-live="polite">
      <div className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-navy-900/10 bg-white p-4 shadow-lg">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => {
            const target = toast.url ?? "/dashboard/notifications";
            setToast(null);
            router.push(target);
          }}
        >
          <p className="truncate text-sm font-semibold text-navy-900">{toast.title}</p>
          <p className="line-clamp-2 text-sm text-slate-500">{toast.body}</p>
        </button>
        <button
          type="button"
          onClick={() => setToast(null)}
          aria-label="Fermer la notification"
          className="shrink-0 text-slate-400 hover:text-slate-600"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/** Interrupteur « son des notifications » + bouton de test (le clic déverrouille aussi l'audio). */
export function NotificationSoundToggle() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    setEnabled(isNotificationSoundEnabled());
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-navy-900/10 bg-white px-4 py-3 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setNotificationSoundEnabled(e.target.checked);
          }}
        />
        <span className="text-navy-900">Son des nouvelles notifications (quand le dashboard est ouvert)</span>
      </label>
      <button type="button" onClick={() => playNotificationChime()} className="text-violet-600 hover:underline">
        Tester le son
      </button>
    </div>
  );
}
