"use client";

import { useEffect, useState } from "react";

/**
 * `<input type="datetime-local">` affiche et soumet une heure LOCALE,
 * sans fuseau explicite — mais `promotion_ends_at` est stocké en UTC
 * (`timestamptz`). À la SOUMISSION, `new Date(value).toISOString()`
 * dans l'action serveur interprète déjà `value` comme l'heure locale du
 * NAVIGATEUR qui a exécuté ce JavaScript, donc ce sens-là est correct
 * même si l'action tourne sur un serveur dans un autre fuseau.
 *
 * À l'AFFICHAGE d'une valeur déjà enregistrée, en revanche, la conversion
 * UTC → local doit utiliser le fuseau du NAVIGATEUR du commerçant, pas
 * celui du serveur qui a rendu la page (souvent UTC) — une conversion
 * faite dans le composant serveur afficherait la mauvaise heure pour
 * n'importe quel commerçant hors UTC. D'où un composant client : la
 * conversion n'est faite qu'après montage, dans le navigateur, quel que
 * soit son fuseau (Cameroun ou ailleurs — jamais supposé).
 */
export function PromotionDeadlineField({ defaultValueIso }: { defaultValueIso: string | null }) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (!defaultValueIso) return;
    const date = new Date(defaultValueIso);
    if (Number.isNaN(date.getTime())) return;
    const offsetMs = date.getTimezoneOffset() * 60000;
    setValue(new Date(date.getTime() - offsetMs).toISOString().slice(0, 16));
  }, [defaultValueIso]);

  return (
    <input
      name="promotionEndsAt"
      type="datetime-local"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      className="rounded-xl border border-navy-900/10 px-4 py-3"
    />
  );
}
