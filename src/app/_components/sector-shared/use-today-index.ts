"use client";

import { useSyncExternalStore } from "react";
import { dayIndex } from "./business-hours";

/**
 * Quel jour de la semaine sommes-nous, dans le NAVIGATEUR du visiteur.
 *
 * Le serveur ne peut pas le savoir de façon fiable — la page peut être
 * servie depuis un cache, et le fuseau du visiteur n'est pas celui du
 * serveur. Plutôt que d'afficher un « aujourd'hui » potentiellement faux,
 * le rendu serveur doit afficher un repli neutre (voir `readTodayOnServer`
 * ci-dessous, -1) et le navigateur le précise ensuite.
 *
 * `useSyncExternalStore` plutôt que `useEffect` + `useState` : c'est la
 * façon prévue par React de lire une valeur qui diffère entre serveur et
 * client, sans double rendu forcé ni avertissement d'hydratation. Il n'y a
 * rien à écouter (le jour ne change pas pendant qu'on lit la page), d'où
 * l'abonnement vide.
 *
 * Partagé entre tous les templates sectoriels qui affichent un « aujourd'hui,
 * ouvert de... » : seule la présentation (classes CSS, texte) diffère d'un
 * secteur à l'autre, pas cette lecture.
 */
const subscribe = () => () => {};
const readToday = () => dayIndex(new Date());
const readTodayOnServer = () => -1;

export function useTodayIndex(): number {
  return useSyncExternalStore(subscribe, readToday, readTodayOnServer);
}
