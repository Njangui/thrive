import Link from "next/link";
import { SOCIAL_BRAND, type SocialPlatformKey } from "./brand-icons";

export interface PlatformTab {
  /** Clé de plateforme (`whatsapp`, `facebook`, …) ; toute valeur inconnue est affichée telle quelle, jamais masquée. */
  key: string;
  count?: number;
}

/**
 * Onglets "un réseau par onglet" (WhatsApp, Facebook, Instagram, Telegram…),
 * pilotés par un paramètre d'URL (`?channel=whatsapp`) : composant serveur,
 * sans état client, même mécanique que les sélecteurs de période de
 * /dashboard/analytics/landing. Réutilisé par la boîte de conversations et
 * par l'analytique des publications pour garder exactement le même système.
 *
 * L'onglet "Tous" (aucun paramètre) est toujours présent en premier.
 */
export function PlatformTabs({
  basePath,
  current,
  tabs,
  paramName = "channel",
  allLabel = "Tous",
  totalCount,
}: {
  basePath: string;
  current: string | null;
  tabs: PlatformTab[];
  paramName?: string;
  allLabel?: string;
  totalCount?: number;
}) {
  const base = "inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-colors";
  const active = "bg-navy-900 text-white";
  const idle = "bg-white text-slate-600 ring-1 ring-navy-900/10 hover:bg-violet-50";

  return (
    <nav aria-label="Filtrer par plateforme" className="flex gap-2 overflow-x-auto pb-1">
      <Link href={basePath} className={`${base} ${current === null ? active : idle}`} aria-current={current === null ? "page" : undefined}>
        {allLabel}
        {totalCount !== undefined ? <span className="text-xs opacity-70">{totalCount}</span> : null}
      </Link>
      {tabs.map((tab) => {
        const brand = SOCIAL_BRAND[tab.key as SocialPlatformKey];
        const isCurrent = current === tab.key;
        return (
          <Link
            key={tab.key}
            href={`${basePath}?${paramName}=${encodeURIComponent(tab.key)}`}
            className={`${base} ${isCurrent ? active : idle}`}
            aria-current={isCurrent ? "page" : undefined}
          >
            {brand ? (
              <span className={`grid h-5 w-5 place-items-center rounded-md text-white ${brand.badgeClassName}`}>
                <brand.Icon className="h-3 w-3" aria-hidden />
              </span>
            ) : null}
            {brand?.label ?? tab.key}
            {tab.count !== undefined ? <span className="text-xs opacity-70">{tab.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
