"use client";

import { useMemo, useState } from "react";
import { geoCentroid, geoMercator } from "d3-geo";
import { feature } from "topojson-client";
import { ComposableMap, Geographies, Geography, Marker } from "react-simple-maps";
import type { Topology } from "topojson-specification";
import type { FeatureCollection, GeoJsonProperties, Geometry } from "geojson";
import type { PublicCountry } from "@/application/services/country-service";
import { isoCodeToFlagEmoji } from "@/application/services/country-service";
import africaTopologyRaw from "@/data/africa-map-topology.json";

/**
 * Carte de l'Afrique — section "Disponible en Afrique" de la landing
 * marketing.
 *
 * Frontières RÉELLES (Natural Earth, via les paquets `world-atlas` +
 * `world-countries`, filtrées à l'Afrique et ré-assemblées en une
 * topologie compacte à la construction — voir `docs/` si ce fichier
 * doit être régénéré). Le résultat est bundlé localement dans
 * `src/data/africa-map-topology.json` : aucun appel réseau à un service
 * cartographique externe au runtime.
 *
 * IMPORTANT (même règle que country-service.ts, section 22) : ce fichier
 * de géométrie ne contient QUE la forme de chaque pays/territoire + son
 * code ISO 3166-1 alpha-2, jamais de donnée commerciale. Nom, devise,
 * indicatif, statut viennent TOUJOURS de `PublicCountry` (donc de la DB,
 * pilotée par le Super Admin) — un pays absent de `countries` ci-dessous,
 * même dessiné sur la carte, n'affiche jamais rien de plus qu'une forme
 * neutre non étiquetée : pas de tooltip, pas d'arrêt clavier dessus.
 */

const MAP_WIDTH = 640;
const MAP_HEIGHT = 700;

const NEUTRAL_FILL = "#EDE9FE"; // violet-100 : continent non renseigné, sur la marque
const NEUTRAL_STROKE = "#C9BEF2";
const ACTIVE_FILL = "#16A34A"; // success-600
const ACTIVE_FILL_HOVER = "#15803D"; // success-700
const UPCOMING_FILL = "#D97706"; // warning-600
const UPCOMING_FILL_HOVER = "#B45309"; // warning-700

interface HoverState {
  iso: string;
  x: number;
  y: number;
}

export function AfricaAvailabilityMap({ countries }: { countries: PublicCountry[] }) {
  const byCode = useMemo(() => new Map(countries.map((c) => [c.isoCode, c] as const)), [countries]);

  // Géométrie fixe et bundlée : ce calcul (conversion topojson -> geojson,
  // projection ajustée pour remplir tout le cadre, centroïde de chaque
  // pays pour positionner tooltip et point "pulse") ne tourne qu'une fois.
  const { geography, projection, centroids } = useMemo(() => {
    const topology = africaTopologyRaw as unknown as Topology<{
      countries: import("topojson-specification").GeometryCollection<{ iso: string }>;
    }>;

    const collection = feature(topology, topology.objects.countries) as unknown as FeatureCollection<
      Geometry,
      GeoJsonProperties
    >;

    const proj = geoMercator().fitSize([MAP_WIDTH, MAP_HEIGHT], collection);

    const centroidByIso = new Map<string, [number, number]>();
    for (const f of collection.features) {
      const iso = f.properties?.iso as string | undefined;
      if (iso) centroidByIso.set(iso, geoCentroid(f));
    }

    return { geography: collection, projection: proj, centroids: centroidByIso };
  }, []);

  const [hovered, setHovered] = useState<HoverState | null>(null);
  const hoveredCountry = hovered ? byCode.get(hovered.iso) : undefined;

  const activeCountries = useMemo(() => countries.filter((c) => c.launchStatus === "active"), [countries]);

  const showHover = (iso: string) => {
    const country = byCode.get(iso);
    const centroid = centroids.get(iso);
    if (!country || !centroid) return;
    const projected = projection(centroid);
    if (!projected) return;
    setHovered({ iso, x: projected[0], y: projected[1] });
  };

  const hideHover = (iso: string) => setHovered((h) => (h?.iso === iso ? null : h));

  return (
    <div className="mx-auto max-w-md">
      <div className="overflow-hidden rounded-3xl border border-navy-900/[0.06] bg-gradient-to-b from-violet-50 to-white p-4 shadow-[0_1px_3px_rgba(16,23,49,0.05)]">
        <div className="relative" onMouseLeave={() => setHovered(null)}>
          <ComposableMap
            width={MAP_WIDTH}
            height={MAP_HEIGHT}
            projection={projection}
            role="img"
            aria-label="Carte d'Afrique indiquant les pays où SME-OS est disponible ou bientôt disponible"
            className="block h-auto w-full"
          >
            <Geographies geography={geography}>
              {({ geographies }) =>
                geographies.map((geo) => {
                  const iso = geo.properties?.iso as string | undefined;
                  const country = iso ? byCode.get(iso) : undefined;
                  const isActive = country?.launchStatus === "active";
                  const isUpcoming = Boolean(country) && !isActive;
                  const isHovered = Boolean(iso) && hovered?.iso === iso;

                  let fill = NEUTRAL_FILL;
                  if (isActive) fill = isHovered ? ACTIVE_FILL_HOVER : ACTIVE_FILL;
                  else if (isUpcoming) fill = isHovered ? UPCOMING_FILL_HOVER : UPCOMING_FILL;

                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={fill}
                      stroke={country ? "#ffffff" : NEUTRAL_STROKE}
                      strokeWidth={country ? 1.1 : 0.6}
                      tabIndex={country ? 0 : -1}
                      style={{
                        outline: "none",
                        cursor: country ? "pointer" : "default",
                        transition: "fill 150ms ease",
                      }}
                      onMouseEnter={() => iso && showHover(iso)}
                      onFocus={() => iso && showHover(iso)}
                      onMouseLeave={() => iso && hideHover(iso)}
                      onBlur={() => iso && hideHover(iso)}
                    />
                  );
                })
              }
            </Geographies>

            {activeCountries.map((c) => {
              const centroid = centroids.get(c.isoCode);
              if (!centroid) return null;
              return (
                <Marker key={c.isoCode} coordinates={centroid}>
                  <circle r={7} fill={ACTIVE_FILL} fillOpacity={0.35} className="animate-ping" />
                  <circle r={3} fill={ACTIVE_FILL} stroke="#ffffff" strokeWidth={1} />
                </Marker>
              );
            })}
          </ComposableMap>

          {hoveredCountry && hovered && (
            <div
              className="pointer-events-none absolute z-10 flex -translate-x-1/2 -translate-y-[130%] items-center gap-1.5 whitespace-nowrap rounded-xl bg-navy-900 px-3 py-2 text-xs font-medium text-white shadow-lg"
              style={{ left: `${(hovered.x / MAP_WIDTH) * 100}%`, top: `${(hovered.y / MAP_HEIGHT) * 100}%` }}
            >
              <span aria-hidden="true">{isoCodeToFlagEmoji(hoveredCountry.isoCode)}</span>
              <span className="font-jakarta">{hoveredCountry.name}</span>
              <span className="text-white/55">
                {hoveredCountry.launchStatus === "active" ? "· disponible" : "· bientôt disponible"}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-success-600" aria-hidden="true" />
          Disponible
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-warning-600" aria-hidden="true" />
          Bientôt disponible
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-violet-200" aria-hidden="true" />
          Pas encore
        </span>
      </div>
    </div>
  );
}
