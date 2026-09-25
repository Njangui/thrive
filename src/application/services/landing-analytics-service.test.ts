import { describe, it, expect } from "vitest";
import {
  aggregateLandingEvents,
  buildVisitorId,
  classifyDevice,
  classifySource,
  isBotUserAgent,
  normalizePath,
  type RawAnalyticsEvent,
} from "./landing-analytics-service";

const NOW = new Date("2026-09-19T12:00:00Z");
const ev = (event_type: string, created_at: string, metadata: Record<string, unknown> | null = null, entity_id: string | null = null): RawAnalyticsEvent => ({
  event_type,
  created_at,
  metadata,
  entity_id,
});

describe("classifySource", () => {
  it("utm_source prime sur le referrer (les apps mobiles n'envoient souvent aucun referrer)", () => {
    expect(classifySource({ referrer: "", utmSource: "facebook" }).source).toBe("Facebook");
    expect(classifySource({ referrer: "https://www.google.com/", utmSource: "whatsapp" }).source).toBe("WhatsApp");
  });

  it("reconnaît les réseaux par le referrer, 'Direct' sans referrer, 'Autre site' sinon", () => {
    expect(classifySource({ referrer: "https://l.instagram.com/?u=x" }).source).toBe("Instagram");
    expect(classifySource({ referrer: "https://www.google.com/search?q=x" }).source).toBe("Google");
    expect(classifySource({ referrer: "https://t.me/mon_canal" }).source).toBe("Telegram");
    expect(classifySource({ referrer: "" }).source).toBe("Direct");
    expect(classifySource({ referrer: "https://blog-quelconque.example/article" }).source).toBe("Autre site");
  });

  it("une navigation interne (même hôte) n'est jamais une source externe", () => {
    expect(classifySource({ referrer: "https://ma-boutique.flexco.com/produits", ownHost: "ma-boutique.flexco.com" }).source).toBe("Direct");
  });
});

describe("classifyDevice / isBotUserAgent / normalizePath", () => {
  it("distingue mobile, tablette et ordinateur", () => {
    expect(classifyDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Mobile/15E148")).toBe("mobile");
    expect(classifyDevice("Mozilla/5.0 (Linux; Android 13; Tecno KI5) AppleWebKit Chrome/120 Mobile Safari")).toBe("mobile");
    expect(classifyDevice("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit")).toBe("tablet");
    expect(classifyDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit Chrome/120 Safari")).toBe("desktop");
  });

  it("écarte les robots et les user-agents vides", () => {
    expect(isBotUserAgent("Googlebot/2.1 (+http://www.google.com/bot.html)")).toBe(true);
    expect(isBotUserAgent("")).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit Chrome/120 Safari")).toBe(false);
  });

  it("normalise les chemins (sans paramètres, ancre ni « / » final)", () => {
    expect(normalizePath("/produits/?page=2#haut")).toBe("/produits");
    expect(normalizePath("/")).toBe("/");
    expect(normalizePath("produits/robe")).toBe("/produits/robe");
  });
});

describe("buildVisitorId", () => {
  it("stable dans la journée, différent d'un jour à l'autre et d'un navigateur à l'autre", () => {
    const a = buildVisitorId("secret", "org", "1.2.3.4", "UA", "2026-09-19");
    expect(buildVisitorId("secret", "org", "1.2.3.4", "UA", "2026-09-19")).toBe(a);
    expect(buildVisitorId("secret", "org", "1.2.3.4", "UA", "2026-09-20")).not.toBe(a);
    expect(buildVisitorId("secret", "org", "1.2.3.4", "UA2", "2026-09-19")).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("aggregateLandingEvents", () => {
  const events: RawAnalyticsEvent[] = [
    ev("page_view", "2026-09-19T08:00:00Z", { path: "/", entry: true, visitor: "v1", source: "Facebook", device: "mobile", country: "CM" }),
    ev("page_view", "2026-09-19T08:01:00Z", { path: "/produits", entry: false, visitor: "v1", device: "mobile" }),
    ev("page_view", "2026-09-19T09:00:00Z", { path: "/", entry: true, visitor: "v2", source: "Direct", device: "desktop", country: "cm" }),
    ev("page_view", "2026-09-18T09:00:00Z", null), // ancien format : pages vues seulement
    ev("cta_click", "2026-09-19T08:02:00Z", { ctaId: "whatsapp" }),
    ev("product_view", "2026-09-19T08:01:00Z", null, "p1"),
    ev("product_click", "2026-09-19T08:01:30Z", null, "p1"),
    ev("video_play", "2026-09-19T08:03:00Z", null, "vid1"),
    ev("lead_created", "2026-09-19T08:05:00Z"),
  ];
  const summary = aggregateLandingEvents(events, 7, NOW);

  it("compte pages vues, visiteurs uniques par jour et conversion", () => {
    expect(summary.totals.pageViews).toBe(4);
    expect(summary.totals.visitors).toBe(2);
    expect(summary.totals.pagesPerVisit).toBe(2);
    expect(summary.totals.leads).toBe(1);
    expect(summary.totals.conversionRate).toBeCloseTo(0.5);
    expect(summary.totals.ctaClicks).toBe(1);
    expect(summary.totals.videoPlays).toBe(1);
  });

  it("source / appareil / pays ne comptent QUE les pages d'entrée (pas chaque page visitée)", () => {
    expect(summary.sources).toEqual([{ label: "Facebook", count: 1 }, { label: "Direct", count: 1 }]);
    expect(summary.devices.map((d) => d.count).reduce((a, b) => a + b, 0)).toBe(2);
    expect(summary.countries).toEqual([{ label: "CM", count: 2 }]);
  });

  it("les anciens page_view sans métadonnées comptent comme des vues de « / » sans fausser visiteurs ni répartitions", () => {
    expect(summary.topPages[0]).toEqual({ path: "/", views: 3 });
  });

  it("série quotidienne complète sur la période, jours vides à zéro", () => {
    expect(summary.daily).toHaveLength(7);
    expect(summary.daily.at(-1)).toEqual({ date: "2026-09-19", pageViews: 3, visitors: 2 });
    expect(summary.daily.at(-2)).toEqual({ date: "2026-09-18", pageViews: 1, visitors: 0 });
    expect(summary.daily[0]).toEqual({ date: "2026-09-13", pageViews: 0, visitors: 0 });
  });

  it("agrège produits, CTA et vidéos", () => {
    expect(summary.products).toEqual([{ id: "p1", views: 1, clicks: 1 }]);
    expect(summary.ctas).toEqual([{ id: "whatsapp", clicks: 1 }]);
    expect(summary.videos).toEqual([{ id: "vid1", plays: 1 }]);
  });

  it("aucun événement : zéros partout, jamais de division par zéro", () => {
    const empty = aggregateLandingEvents([], 30, NOW);
    expect(empty.totals.pagesPerVisit).toBe(0);
    expect(empty.totals.conversionRate).toBe(0);
    expect(empty.daily).toHaveLength(30);
  });
});
