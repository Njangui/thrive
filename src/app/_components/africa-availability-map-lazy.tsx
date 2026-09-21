"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { PublicCountry } from "@/application/services/country-service";

/**
 * Chargement DIFFÉRÉ de la carte « Disponible en Afrique » de la landing marketing.
 *
 * Pourquoi : `africa-availability-map.tsx` embarque d3-geo + topojson-client + react-simple-maps
 * + la topologie du continent (~41 Ko) — un chunk d'environ 137 Ko (non compressé) qui était
 * téléchargé et évalué au chargement de la page d'accueil alors que la carte est située bien
 * plus bas. Ici il n'est demandé que lorsque la section approche de l'écran (marge de 400 px).
 *
 * La carte est décorative pour les moteurs de recherche : la liste des pays (noms, statuts)
 * est rendue côté serveur par `marketing-landing.tsx`, hors de ce composant. Le cadre réserve
 * la hauteur exacte de la carte (ratio 640 × 700 de `MAP_WIDTH`/`MAP_HEIGHT`) pour éviter tout
 * décalage de mise en page à l'apparition.
 */
function MapPlaceholder() {
  return (
    <div className="mx-auto max-w-md" aria-hidden="true">
      <div className="overflow-hidden rounded-3xl border border-navy-900/[0.06] bg-gradient-to-b from-violet-50 to-white p-4 shadow-[0_1px_3px_rgba(16,23,49,0.05)]">
        <div className="w-full" style={{ aspectRatio: "640 / 700" }} />
      </div>
      <div className="mt-4 h-4" />
    </div>
  );
}

const AfricaAvailabilityMap = dynamic(
  () => import("./africa-availability-map").then((module) => module.AfricaAvailabilityMap),
  { ssr: false, loading: () => <MapPlaceholder /> },
);

export function LazyAfricaAvailabilityMap({ countries }: { countries: PublicCountry[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      // Navigateur sans IntersectionObserver : on charge juste après le premier rendu.
      const timer = window.setTimeout(() => setNearViewport(true), 0);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return <div ref={containerRef}>{nearViewport ? <AfricaAvailabilityMap countries={countries} /> : <MapPlaceholder />}</div>;
}
