"use client";

import { useEffect, useState, useTransition } from "react";
import {
  isPushSupportedByBrowser,
  getExistingPushSubscription,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/app/_components/service-worker-register";
import { savePushSubscriptionAction, removePushSubscriptionAction } from "./push-actions";

/**
 * Toggle "notifications sur cet appareil" — cahier Lot I, Partie 1 : "un
 * simple toggle dans /dashboard/notifications, pas un écran séparé".
 *
 * L'état affiché reflète la souscription RÉELLE de CE navigateur (via
 * `getExistingPushSubscription`), pas une valeur déduite de la base de
 * données côté serveur — un commerçant peut avoir activé les
 * notifications sur son téléphone mais pas sur son ordinateur de bureau,
 * et le toggle doit refléter l'appareil sur lequel il se trouve
 * actuellement, pas un état global de l'organisation.
 */
export function PushToggle({
  organizationId,
  vapidPublicKey,
}: {
  organizationId: string;
  vapidPublicKey: string;
}) {
  const [supported, setSupported] = useState(true);
  // null = état pas encore déterminé (évite un flash "Activer" avant de
  // savoir si ce navigateur est déjà abonné).
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [justEnabled, setJustEnabled] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!isPushSupportedByBrowser()) {
      setSupported(false);
      setEnabled(false);
      return;
    }
    getExistingPushSubscription()
      .then((subscription) => setEnabled(Boolean(subscription)))
      .catch(() => setEnabled(false));
  }, []);

  function handleToggle() {
    setError(null);
    setJustEnabled(false);
    startTransition(async () => {
      try {
        if (enabled) {
          const endpoint = await unsubscribeFromPush();
          if (endpoint) {
            const result = await removePushSubscriptionAction(organizationId, endpoint);
            if (!result.ok) throw new Error(result.error);
          }
          setEnabled(false);
        } else {
          const subscription = await subscribeToPush(vapidPublicKey);
          const result = await savePushSubscriptionAction(organizationId, JSON.stringify(subscription));
          if (!result.ok) throw new Error(result.error);
          setEnabled(true);
          setJustEnabled(true);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur lors de la mise à jour des notifications.");
      }
    });
  }

  if (!supported || enabled === null) return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-brand border border-ink/10 bg-white px-4 py-3">
      <div>
        <p className="text-sm font-medium text-ink">Notifications sur cet appareil</p>
        <p className="text-xs text-muted">Recevez une alerte même quand SME-OS est fermé.</p>
        {error && <p className="mt-1 text-xs text-clay">{error}</p>}
        {justEnabled && !error && (
          <p className="mt-1 text-xs text-leaf">Activées — une notification de test vient d&apos;être envoyée.</p>
        )}
      </div>
      <button
        type="button"
        onClick={handleToggle}
        disabled={isPending}
        className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60 ${
          enabled ? "bg-clay" : "bg-leaf"
        }`}
      >
        {isPending ? "..." : enabled ? "Désactiver" : "Activer"}
      </button>
    </div>
  );
}
