"use client";

import { IconClock } from "../storefront/storefront-icons";
import { DAYS, type HoursEntry } from "../sector-shared/business-hours";
import { useTodayIndex } from "../sector-shared/use-today-index";

/**
 * Présentation « prestataire de service » des horaires (classes `ps-*`) au-dessus
 * du hook partagé `useTodayIndex`. Équivalent du `restaurant/hours-client.tsx`
 * (classes `rl-*`) — seule la présentation diffère entre les deux templates.
 */

export function TodayHours({ entries, summary }: { entries: HoursEntry[]; summary: string | null }) {
  const today = useTodayIndex();
  const entry = today >= 0 ? entries.find((e) => e.day === DAYS[today]) : undefined;

  let text: string;
  if (entry) text = `Aujourd'hui, ${entry.hours}`;
  else if (today >= 0) text = "Fermé aujourd'hui";
  else text = summary ? `Tous les jours, ${summary}` : "Voir les horaires";

  return (
    <a className="ps-dock__link" href="#infos">
      <IconClock className="ps-dock__icon" />
      <span className="ps-sr">Horaires : </span>
      <span>{text}</span>
    </a>
  );
}

export function HoursTable({ entries }: { entries: HoursEntry[] }) {
  const today = useTodayIndex();
  return (
    <dl className="ps-hours">
      {entries.map((entry) => {
        const isToday = today >= 0 && DAYS[today] === entry.day;
        return (
          <div key={entry.day} className="ps-hours__row" data-today={isToday ? "true" : undefined}>
            <dt>
              {entry.label}
              {isToday && <span className="ps-hours__today"> (aujourd&apos;hui)</span>}
            </dt>
            <dd>{entry.hours}</dd>
          </div>
        );
      })}
    </dl>
  );
}
