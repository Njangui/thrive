"use client";

import { useEffect, useState } from "react";

/**
 * Catalogue V2, itération 2 (0057) — le seul compte à rebours de ce
 * projet, branché sur une vraie échéance (`products.promotion_ends_at`),
 * jamais une durée inventée. Une session précédente avait explicitement
 * renoncé à cette fonctionnalité tant que cette donnée n'existait pas
 * (voir l'ancien commentaire de `landing-sections/promotions.tsx`) : un
 * compte à rebours sans échéance réelle se réinitialiserait à chaque
 * rechargement et mentirait au client du commerçant. Celui-ci ne fait
 * jamais ça — il affiche l'écart entre `endsAt` et l'horloge du
 * navigateur, point.
 *
 * Composant client par nécessité : la valeur change chaque seconde, ce
 * qu'un composant serveur ne peut pas faire après le rendu initial.
 * S'auto-masque dès que l'échéance est dépassée — y compris pour une
 * page restée ouverte pendant que le compte à rebours arrive à zéro —
 * plutôt que d'afficher "00j 00h 00m 00s" indéfiniment.
 */
export function CountdownTimer({
  endsAt,
  variant = "full",
  className = "",
}: {
  endsAt: string;
  /** "full" : bloc avec libellés (fiche produit, bannière Promotions). "compact" : pastille courte (carte produit). */
  variant?: "full" | "compact";
  className?: string;
}) {
  const [remainingMs, setRemainingMs] = useState<number | null>(null);

  useEffect(() => {
    const deadline = Date.parse(endsAt);
    if (Number.isNaN(deadline)) return;

    const tick = () => setRemainingMs(Math.max(0, deadline - Date.now()));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [endsAt]);

  // Rien tant que l'effet n'a pas tourné (évite un flash "0j 0h 0m 0s" au
  // premier rendu serveur) et plus rien une fois l'échéance dépassée.
  if (remainingMs === null || remainingMs <= 0) return null;

  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  if (variant === "compact") {
    const label = days > 0 ? `${days}j ${pad(hours)}h` : hours > 0 ? `${hours}h ${pad(minutes)}m` : `${pad(minutes)}m ${pad(seconds)}s`;
    return (
      <span className={`inline-flex items-center gap-1 rounded-full bg-black/80 px-2.5 py-1 text-[11px] font-semibold text-white ${className}`}>
        <IconTimer className="h-3 w-3" />
        {label}
      </span>
    );
  }

  const units: { value: number; label: string }[] = [
    { value: days, label: "jours" },
    { value: hours, label: "heures" },
    { value: minutes, label: "min" },
    { value: seconds, label: "sec" },
  ];

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      {units.map((unit, index) => (
        <div key={unit.label} className="flex items-center gap-2">
          {index > 0 && <span className="text-black/25">:</span>}
          <div className="flex flex-col items-center rounded-xl bg-black/[0.06] px-2.5 py-1.5">
            <span className="font-display text-lg font-bold leading-none tabular-nums">{pad(unit.value)}</span>
            <span className="mt-0.5 text-[10px] uppercase tracking-wide text-black/50">{unit.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function IconTimer({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5" />
      <path d="M9 2h6" />
    </svg>
  );
}
