"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { trackPageViewAction } from "../track-visit-actions";

const SESSION_KEY = "cresyva:storefront-session";

/**
 * Compte une page vue à chaque page de la vitrine visitée (y compris les
 * navigations internes, qui ne rechargent pas la page).
 *
 * Exécuté dans le navigateur : les robots qui n'exécutent pas JavaScript ne
 * sont jamais comptés. Seule la PREMIÈRE page d'un onglet (`entry`) envoie
 * le referrer et les paramètres UTM — c'est elle qui dit d'où vient la
 * visite ; les pages suivantes n'auraient sinon toutes que le même referrer
 * d'origine et gonfleraient la source d'un seul clic.
 */
export function StorefrontPageTracker() {
  const pathname = usePathname();

  useEffect(() => {
    let entry = true;
    try {
      if (window.sessionStorage.getItem(SESSION_KEY)) entry = false;
      else window.sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* stockage indisponible (navigation privée stricte) : chaque page compte comme une entrée */
    }
    void trackPageViewAction({
      path: pathname,
      entry,
      referrer: entry ? document.referrer : "",
      search: entry ? window.location.search : "",
    });
  }, [pathname]);

  return null;
}
