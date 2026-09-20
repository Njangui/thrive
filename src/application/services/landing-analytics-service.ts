import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import { getSupabaseServiceClient } from "@/infrastructure/supabase/server-client";
import { trackEvent } from "./analytics-service";

/**
 * Analytique de la vitrine / landing d'un tenant.
 *
 * Collecte SANS cookie ni identifiant persistant : le « visiteur » est un
 * haché HMAC (organisation + jour + IP + navigateur) qui change chaque jour
 * et ne peut pas être inversé (clé secrète serveur). On mesure donc des
 * visiteurs UNIQUES PAR JOUR — jamais un suivi d'une personne d'un jour à
 * l'autre. Pas de bandeau de consentement nécessaire.
 */

// ---------------------------------------------------------------------------
// Fonctions pures (testées en isolation)
// ---------------------------------------------------------------------------

const BOT_PATTERN = /bot|crawl|spider|slurp|preview|headless|lighthouse|pingdom|curl|wget|python-requests|facebookexternalhit/i;

/** Le traceur tourne dans le navigateur (JS) : les robots l'exécutent rarement — ce filtre écarte les restants. */
export function isBotUserAgent(userAgent: string): boolean {
  return userAgent.trim().length < 10 || BOT_PATTERN.test(userAgent);
}

export type DeviceClass = "mobile" | "tablet" | "desktop";

export function classifyDevice(userAgent: string): DeviceClass {
  if (/ipad|tablet|android(?!.*mobile)/i.test(userAgent)) return "tablet";
  if (/mobi|iphone|ipod|android/i.test(userAgent)) return "mobile";
  return "desktop";
}

const SOURCE_RULES: Array<[RegExp, string]> = [
  [/(^|\.)google\./, "Google"],
  [/(^|\.)(bing|duckduckgo|yahoo|ecosia)\./, "Autre moteur de recherche"],
  [/(^|\.)(facebook|fb)\.(com|me)$|(^|\.)fb\.com$/, "Facebook"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, "WhatsApp"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "YouTube"],
  [/(^|\.)(t\.me|telegram\.(org|me))$/, "Telegram"],
  [/(^|\.)(twitter\.com|x\.com|t\.co)$/, "X (Twitter)"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "LinkedIn"],
];

function labelForSourceName(name: string): string | null {
  const value = name.trim().toLowerCase();
  if (!value) return null;
  for (const [pattern, label] of SOURCE_RULES) if (pattern.test(value) || pattern.test(`${value}.com`)) return label;
  return null;
}

/**
 * Origine d'une session. `utm_source` (lien partagé par le commerçant, ex.
 * ?utm_source=facebook) prime sur le referrer : les applications mobiles
 * (Instagram, WhatsApp, TikTok) n'envoient souvent AUCUN referrer, l'UTM est
 * alors la seule façon fiable de savoir d'où vient la visite.
 */
export function classifySource(input: { referrer: string; utmSource?: string | null; ownHost?: string | null }): {
  source: string;
  referrerHost: string | null;
} {
  let referrerHost: string | null = null;
  try {
    referrerHost = input.referrer ? new URL(input.referrer).hostname.toLowerCase() : null;
  } catch {
    referrerHost = null;
  }

  const utm = input.utmSource ? labelForSourceName(input.utmSource) ?? input.utmSource.trim().slice(0, 40) : null;
  if (utm) return { source: utm, referrerHost };

  if (!referrerHost) return { source: "Direct", referrerHost: null };
  if (input.ownHost && referrerHost === input.ownHost.toLowerCase().split(":")[0]) return { source: "Direct", referrerHost };

  for (const [pattern, label] of SOURCE_RULES) if (pattern.test(referrerHost)) return { source: label, referrerHost };
  return { source: "Autre site", referrerHost };
}

/** Chemin sans paramètres ni ancre, sans « / » final (sauf la racine), borné. */
export function normalizePath(path: string): string {
  const clean = (path.split("?")[0] ?? "").split("#")[0] ?? "";
  const withSlash = clean.startsWith("/") ? clean : `/${clean}`;
  const trimmed = withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
  return trimmed.slice(0, 120) || "/";
}

export function buildVisitorId(secret: string, organizationId: string, ip: string, userAgent: string, day: string): string {
  return createHmac("sha256", secret).update(`${organizationId}|${day}|${ip}|${userAgent}`).digest("hex").slice(0, 16);
}

export interface RawAnalyticsEvent {
  event_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface LandingAnalyticsSummary {
  days: number;
  truncated: boolean;
  totals: {
    pageViews: number;
    visitors: number;
    pagesPerVisit: number;
    ctaClicks: number;
    videoPlays: number;
    leads: number;
    orders: number;
    /** Nouveaux prospects / visiteurs, entre 0 et 1. */
    conversionRate: number;
  };
  daily: Array<{ date: string; pageViews: number; visitors: number }>;
  topPages: Array<{ path: string; views: number }>;
  sources: Array<{ label: string; count: number }>;
  devices: Array<{ label: string; count: number }>;
  countries: Array<{ label: string; count: number }>;
  ctas: Array<{ id: string; clicks: number }>;
  products: Array<{ id: string; views: number; clicks: number }>;
  videos: Array<{ id: string; plays: number }>;
}

function meta(event: RawAnalyticsEvent, key: string): unknown {
  return event.metadata?.[key];
}

function ranked(map: Map<string, number>, limit: number): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

const DEVICE_LABELS: Record<string, string> = { mobile: "Mobile", tablet: "Tablette", desktop: "Ordinateur" };

/**
 * Agrège les événements bruts. Deux familles de `page_view` coexistent :
 *  - récents : `metadata.path` renseigné (+ visiteur, source, appareil...) ;
 *  - anciens (avant 0060) : sans métadonnées — comptés dans les pages vues
 *    (page « / »), mais ni dans les visiteurs ni dans les répartitions.
 * Source / appareil / pays ne comptent que les pages d'ENTRÉE d'une session
 * (`metadata.entry`), sinon chaque page visitée gonflerait « Direct ».
 */
export function aggregateLandingEvents(
  events: RawAnalyticsEvent[],
  days: number,
  now: Date = new Date(),
  truncated = false,
): LandingAnalyticsSummary {
  const dailyPageViews = new Map<string, number>();
  const dailyVisitors = new Map<string, Set<string>>();
  const allVisitors = new Set<string>();
  const pages = new Map<string, number>();
  const sources = new Map<string, number>();
  const devices = new Map<string, number>();
  const countries = new Map<string, number>();
  const ctas = new Map<string, number>();
  const productViews = new Map<string, number>();
  const productClicks = new Map<string, number>();
  const videos = new Map<string, number>();
  let pageViews = 0, ctaClicks = 0, videoPlays = 0, leads = 0, orders = 0;

  for (const event of events) {
    const day = event.created_at.slice(0, 10);
    switch (event.event_type) {
      case "page_view": {
        pageViews += 1;
        dailyPageViews.set(day, (dailyPageViews.get(day) ?? 0) + 1);
        const path = typeof meta(event, "path") === "string" ? (meta(event, "path") as string) : "/";
        pages.set(path, (pages.get(path) ?? 0) + 1);

        const visitor = meta(event, "visitor");
        if (typeof visitor === "string" && visitor) {
          const key = `${day}|${visitor}`;
          allVisitors.add(key);
          const set = dailyVisitors.get(day) ?? new Set<string>();
          set.add(visitor);
          dailyVisitors.set(day, set);
        }
        if (meta(event, "entry") === true) {
          const source = typeof meta(event, "source") === "string" ? (meta(event, "source") as string) : "Direct";
          sources.set(source, (sources.get(source) ?? 0) + 1);
          const device = DEVICE_LABELS[String(meta(event, "device"))] ?? null;
          if (device) devices.set(device, (devices.get(device) ?? 0) + 1);
          const country = meta(event, "country");
          if (typeof country === "string" && /^[A-Za-z]{2}$/.test(country)) {
            const code = country.toUpperCase();
            countries.set(code, (countries.get(code) ?? 0) + 1);
          }
        }
        break;
      }
      case "cta_click": {
        ctaClicks += 1;
        const id = String(meta(event, "ctaId") ?? meta(event, "cta_id") ?? "inconnu");
        ctas.set(id, (ctas.get(id) ?? 0) + 1);
        break;
      }
      case "product_view":
        if (event.entity_id) productViews.set(event.entity_id, (productViews.get(event.entity_id) ?? 0) + 1);
        break;
      case "product_click":
        if (event.entity_id) productClicks.set(event.entity_id, (productClicks.get(event.entity_id) ?? 0) + 1);
        break;
      case "video_play":
        videoPlays += 1;
        if (event.entity_id) videos.set(event.entity_id, (videos.get(event.entity_id) ?? 0) + 1);
        break;
      case "lead_created":
        leads += 1;
        break;
      case "order_created":
        orders += 1;
        break;
    }
  }

  const daily: LandingAnalyticsSummary["daily"] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now.getTime() - offset * 86_400_000).toISOString().slice(0, 10);
    daily.push({ date, pageViews: dailyPageViews.get(date) ?? 0, visitors: dailyVisitors.get(date)?.size ?? 0 });
  }

  const visitors = allVisitors.size;
  const productIds = new Set([...productViews.keys(), ...productClicks.keys()]);

  return {
    days,
    truncated,
    totals: {
      pageViews,
      visitors,
      pagesPerVisit: visitors > 0 ? Math.round((pageViews / visitors) * 10) / 10 : 0,
      ctaClicks,
      videoPlays,
      leads,
      orders,
      conversionRate: visitors > 0 ? leads / visitors : 0,
    },
    daily,
    topPages: ranked(pages, 10).map(([path, views]) => ({ path, views })),
    sources: ranked(sources, 8).map(([label, count]) => ({ label, count })),
    devices: ranked(devices, 3).map(([label, count]) => ({ label, count })),
    countries: ranked(countries, 8).map(([label, count]) => ({ label, count })),
    ctas: ranked(ctas, 8).map(([id, clicks]) => ({ id, clicks })),
    products: [...productIds]
      .map((id) => ({ id, views: productViews.get(id) ?? 0, clicks: productClicks.get(id) ?? 0 }))
      .sort((a, b) => b.views + b.clicks - (a.views + a.clicks))
      .slice(0, 8),
    videos: ranked(videos, 8).map(([id, plays]) => ({ id, plays })),
  };
}

// ---------------------------------------------------------------------------
// Écriture
// ---------------------------------------------------------------------------

export interface StorefrontVisitInput {
  path: string;
  /** Première page de la session (onglet) — seule à porter source/appareil/pays. */
  entry: boolean;
  referrer: string;
  search: string;
  userAgent: string;
  ip: string;
  country: string | null;
  ownHost: string | null;
}

/** Enregistre une page vue de la vitrine. Ne lève jamais (délègue à trackEvent, qui ne lève jamais). */
export async function recordStorefrontVisit(organizationId: string, input: StorefrontVisitInput): Promise<void> {
  if (isBotUserAgent(input.userAgent)) return;

  const path = normalizePath(input.path);
  if (/^\/(dashboard|api|_next|admin)(\/|$)/.test(path)) return;

  const params = new URLSearchParams(input.search.startsWith("?") ? input.search.slice(1) : input.search);
  const { source, referrerHost } = classifySource({
    referrer: input.entry ? input.referrer : "",
    utmSource: input.entry ? params.get("utm_source") : null,
    ownHost: input.ownHost,
  });
  const day = new Date().toISOString().slice(0, 10);

  await trackEvent(organizationId, "page_view", "page", undefined, {
    path,
    entry: input.entry,
    visitor: buildVisitorId(env.SUPABASE_SERVICE_ROLE_KEY, organizationId, input.ip, input.userAgent, day),
    device: classifyDevice(input.userAgent),
    ...(input.entry ? { source, referrerHost, campaign: params.get("utm_campaign")?.slice(0, 60) ?? null } : {}),
    ...(input.country ? { country: input.country.toUpperCase().slice(0, 2) } : {}),
  });
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

const PAGE_SIZE = 1000; // plafond de lignes par requête côté Supabase
const MAX_PAGES = 20; // 20 000 événements au maximum par affichage

const ANALYTICS_TYPES = ["page_view", "product_view", "product_click", "cta_click", "video_play", "lead_created", "order_created"];

export interface LandingAnalyticsReport {
  summary: LandingAnalyticsSummary;
  productNames: Record<string, string>;
  videoTitles: Record<string, string>;
}

export async function getLandingAnalytics(organizationId: string, days: number): Promise<LandingAnalyticsReport> {
  const supabase = getSupabaseServiceClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const events: RawAnalyticsEvent[] = [];
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabase
      .from("analytics_events")
      .select("event_type, entity_id, metadata, created_at")
      .eq("organization_id", organizationId)
      .in("event_type", ANALYTICS_TYPES)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw new Error(`Erreur lecture analytique: ${error.message}`);
    const rows = (data ?? []) as RawAnalyticsEvent[];
    events.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  const summary = aggregateLandingEvents(events, days, new Date(), truncated);

  const productIds = summary.products.map((p) => p.id);
  const videoIds = summary.videos.map((v) => v.id);
  const [productRows, videoRows] = await Promise.all([
    productIds.length
      ? supabase.from("products").select("id, name").eq("organization_id", organizationId).in("id", productIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    videoIds.length
      ? supabase.from("catalog_videos").select("id, title").eq("organization_id", organizationId).in("id", videoIds)
      : Promise.resolve({ data: [] as Array<{ id: string; title: string | null }> }),
  ]);

  return {
    summary,
    productNames: Object.fromEntries((productRows.data ?? []).map((row) => [row.id, row.name])),
    videoTitles: Object.fromEntries((videoRows.data ?? []).map((row) => [row.id, row.title ?? "Vidéo"])),
  };
}
