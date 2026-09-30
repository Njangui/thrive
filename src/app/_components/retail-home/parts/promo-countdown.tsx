"use client";

import { useEffect, useState } from "react";

/**
 * Compte à rebours du bandeau d'offres. Même règle que
 * `storefront/countdown-timer.tsx` : il n'affiche QUE l'écart entre une
 * échéance réelle (`products.promotion_ends_at`) et l'horloge du
 * navigateur — jamais une durée simulée — et se masque de lui-même une
 * fois l'échéance dépassée.
 *
 * Pourquoi un second composant : le `CountdownTimer` partagé impose des
 * chiffres sur fond noir translucide et des libellés `text-black/50`,
 * illisibles sur une couleur d'accent sombre. Celui-ci hérite la couleur
 * du bandeau (donc le contraste calculé par `buildRetailThemeStyle`).
 */
export function PromoCountdown({ endsAt }: { endsAt: string }) {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    const deadline = Date.parse(endsAt);
    if (Number.isNaN(deadline)) return;

    const tick = () => setRemainingMs(Math.max(0, deadline - Date.now()));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [endsAt]);

  // Rien avant le premier tick côté navigateur (évite un « 00 : 00 » au rendu serveur) ni après l'échéance.
  if (remainingMs === null || remainingMs <= 0) return null;
  return <PromoCountdownView remainingMs={remainingMs} />;
}

/** Affichage pur du temps restant : séparé du minuteur pour pouvoir être rendu (et vérifié) sans horloge. */
export function PromoCountdownView({ remainingMs }: { remainingMs: number }) {
  const totalSeconds = Math.floor(remainingMs / 1000);
  const units = [
    { value: Math.floor(totalSeconds / 86400), label: "jours" },
    { value: Math.floor((totalSeconds % 86400) / 3600), label: "heures" },
    { value: Math.floor((totalSeconds % 3600) / 60), label: "min" },
    { value: totalSeconds % 60, label: "sec" },
  ];

  return (
    <div className="rt-timer" role="timer" aria-label="Temps restant avant la fin des offres">
      <span className="rt-timer__label">Se termine dans</span>
      <div className="rt-timer__units">
        {units.map((unit) => (
          <div key={unit.label} className="rt-timer__unit">
            <span className="rt-timer__value">{String(unit.value).padStart(2, "0")}</span>
            <span className="rt-timer__unit-label">{unit.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
