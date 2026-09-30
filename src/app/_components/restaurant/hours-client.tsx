"use client";

import { IconClock } from "../storefront/storefront-icons";
import { DAYS, type HoursEntry } from "../sector-shared/business-hours";
import { useTodayIndex } from "../sector-shared/use-today-index";

/**
 * Présentation restaurant des horaires (classes `rl-*`) au-dessus du hook
 * partagé `useTodayIndex` — voir ce fichier pour pourquoi c'est un composant
 * client. Le prestataire de service a son équivalent avec ses propres
 * classes dans `prestataire/hours-client.tsx` ; seule la présentation diffère.
 */

/** Élément de la barre d'infos du hero : horaires du jour, ou repli neutre tant que le jour est inconnu. */
export function TodayHours({ entries, summary }: { entries: HoursEntry[]; summary: string | null }) {
  const today = useTodayIndex();
  const entry = today >= 0 ? entries.find((e) => e.day === DAYS[today]) : undefined;

  let text: string;
  if (entry) text = `Aujourd'hui, ${entry.hours}`;
  else if (today >= 0) text = "Fermé aujourd'hui";
  else text = summary ? `Tous les jours, ${summary}` : "Voir les horaires";

  return (
    <a className="rl-dock__link" href="#infos">
      <IconClock className="rl-dock__icon" />
      <span className="rl-sr">Horaires : </span>
      <span>{text}</span>
    </a>
  );
}

/** Tableau des horaires de la semaine, avec le jour courant signalé (texte ET graisse, jamais la couleur seule). */
export function HoursTable({ entries }: { entries: HoursEntry[] }) {
  const today = useTodayIndex();
  return (
    <dl className="rl-hours">
      {entries.map((entry) => {
        const isToday = today >= 0 && DAYS[today] === entry.day;
        return (
          <div key={entry.day} className="rl-hours__row" data-today={isToday ? "true" : undefined}>
            <dt>
              {entry.label}
              {isToday && <span className="rl-hours__today"> (aujourd&apos;hui)</span>}
            </dt>
            <dd>{entry.hours}</dd>
          </div>
        );
      })}
    </dl>
  );
}
