import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: vi.fn() }));
vi.mock("./entitlements-service", () => ({ canUseFeature: vi.fn() }));
vi.mock("./auth-service", () => ({ requireMembership: vi.fn() }));
vi.mock("@/infrastructure/providers/social/youtube/client", () => ({ YouTubeClient: class {} }));

import { makeYouTubeState, readYouTubeState, youtubeStateSecret } from "./youtube-channel-service";

const ORG = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const SECRET = "x".repeat(40);

describe("état OAuth YouTube (audit S1/S2, Q26)", () => {
  const prev = { s: process.env.YOUTUBE_OAUTH_STATE_SECRET, c: process.env.CRON_SECRET };
  beforeEach(() => { process.env.YOUTUBE_OAUTH_STATE_SECRET = SECRET; process.env.CRON_SECRET = "cron-secret-should-not-be-used-ever"; });
  afterEach(() => { process.env.YOUTUBE_OAUTH_STATE_SECRET = prev.s; process.env.CRON_SECRET = prev.c; });

  it("aller-retour : org + utilisateur", () => {
    expect(readYouTubeState(makeYouTubeState(ORG, USER))).toEqual({ organizationId: ORG, userId: USER });
  });
  it("sans secret dédié (ou trop court) : aucun repli, erreur", () => {
    delete process.env.YOUTUBE_OAUTH_STATE_SECRET;
    expect(() => makeYouTubeState(ORG, USER)).toThrow(/YOUTUBE_OAUTH_STATE_SECRET/);
    process.env.YOUTUBE_OAUTH_STATE_SECRET = "court";
    expect(() => youtubeStateSecret()).toThrow();
  });
  it("falsification de l'utilisateur ou de l'organisation : refus", () => {
    const st = makeYouTubeState(ORG, USER);
    const other = "33333333-3333-3333-3333-333333333333";
    expect(() => readYouTubeState(st.replace(USER, other))).toThrow(/invalide/);
    expect(() => readYouTubeState(st.replace(ORG, other))).toThrow(/invalide/);
    const last = st.slice(-1);
    expect(() => readYouTubeState(st.slice(0, -1) + (last === "0" ? "1" : "0"))).toThrow(/invalide/);
  });
  it("signé avec un autre secret : refus ; expiré (> 10 min) : refus", () => {
    const st = makeYouTubeState(ORG, USER, 1_000_000);
    expect(() => readYouTubeState(st, 1_000_000 + 11 * 60 * 1000)).toThrow(/expiré/);
    expect(readYouTubeState(st, 1_000_000 + 60_000).userId).toBe(USER);
    process.env.YOUTUBE_OAUTH_STATE_SECRET = "y".repeat(40);
    expect(() => readYouTubeState(st, 1_000_000 + 60_000)).toThrow(/invalide/);
  });
});
