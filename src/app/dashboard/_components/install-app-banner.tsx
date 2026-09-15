"use client";

import { useEffect, useState } from "react";

/**
 * Bannière d'installation PWA — jusqu'ici absente du projet : le service
 * worker et le manifest (voir service-worker-register.tsx,
 * public/manifest.json) rendent l'app installable, mais rien ne
 * capturait `beforeinstallprompt` pour le proposer activement. Sans ça,
 * seule l'icône discrète de la barre d'adresse Chrome desktop (ou le menu
 * "Ajouter à l'écran d'accueil" sur mobile) permettait l'installation —
 * facile à ne jamais remarquer.
 *
 * Montée uniquement dans le dashboard marchand (voir dashboard/layout.tsx)
 * : c'est le `start_url` du manifest (`/dashboard`), donc le contexte où
 * l'installation a un sens (jamais sur la vitrine publique d'un tenant,
 * qui n'a pas vocation à être "installée" par un visiteur).
 *
 * Deux chemins distincts :
 * - Android/Desktop Chrome/Edge : événement `beforeinstallprompt` natif,
 *   on affiche notre propre CTA et on déclenche `prompt()` au clic.
 * - iOS Safari : cet événement n'existe pas et n'existera jamais
 *   (Apple ne l'implémente pas) — seul un rappel manuel ("Partager ->
 *   Sur l'écran d'accueil") est possible, jamais un vrai déclenchement
 *   programmatique.
 *
 * Ne s'affiche jamais si l'app tourne déjà en mode standalone (déjà
 * installée), et se souvient d'un rejet pendant 14 jours (localStorage)
 * pour ne pas harceler l'utilisateur à chaque connexion.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "sme-os:install-banner-dismissed-at";
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 jours

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // Safari iOS : pas de Display Mode Media Query avant iOS 16.4, propriété dédiée en repli.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isRecentlyDismissed(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(DISMISS_KEY);
  if (!raw) return false;
  const dismissedAt = Number(raw);
  if (Number.isNaN(dismissedAt)) return false;
  return Date.now() - dismissedAt < DISMISS_COOLDOWN_MS;
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function InstallAppBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (isStandalone() || isRecentlyDismissed()) return;

    if (isIos()) {
      // Pas d'événement à écouter sur iOS — on affiche directement le rappel manuel.
      setShowIosHint(true);
      return;
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setDismissed(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    // `userChoice` se résout que l'utilisateur accepte ou refuse — dans les
    // deux cas l'événement capturé n'est plus réutilisable, on referme.
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  };

  if (dismissed || (!deferredPrompt && !showIosHint)) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-navy-900/[0.06] bg-violet-50 px-4 py-2.5 text-sm text-navy-900 sm:px-6">
      <p className="font-medium">
        {showIosHint
          ? "Installez SME-OS sur cet iPhone : appuyez sur Partager, puis « Sur l'écran d'accueil »."
          : "Installez SME-OS sur cet appareil pour y accéder en un tap, comme une vraie appli."}
      </p>
      <div className="flex items-center gap-2">
        {!showIosHint && (
          <button type="button" onClick={handleInstallClick} className="adm-btn-primary !px-4 !py-2 text-xs">
            Installer l&apos;application
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Fermer"
          className="rounded-lg px-2 py-1 text-navy-900/50 transition hover:bg-navy-900/[0.06] hover:text-navy-900"
        >
          ✕
        </button>
      </div>
    </div>
  );
}