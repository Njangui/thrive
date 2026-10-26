import { beforeEach, describe, expect, it, vi } from "vitest";

const state: { fail: boolean; result: unknown; calls: number } = { fail: false, result: {}, calls: 0 };
vi.mock("@/infrastructure/agents/agents-tick", () => ({
  runAgentsTick: async () => {
    state.calls += 1;
    if (state.fail) throw new Error("secret interne");
    return state.result;
  },
}));
vi.mock("@/lib/cron-auth", () => ({
  verifyCronAuth: (r: Request) =>
    r.headers.get("authorization") === "Bearer ok"
      ? { authorized: true, status: 200, body: { error: "" } }
      : { authorized: false, status: 401, body: { error: "unauthorized" } },
}));
import { GET, POST } from "./route";

const authed = () => new Request("http://x", { headers: { authorization: "Bearer ok" } });

describe("/api/cron/agents-tick", () => {
  beforeEach(() => Object.assign(state, { fail: false, result: {}, calls: 0 }));

  it("401 sans secret, aucun travail lancé", async () => {
    const res = await POST(new Request("http://x/api/cron/agents-tick", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(state.calls).toBe(0);
  });

  it("200 avec le rapport quand autorisé", async () => {
    state.result = { events: { claimed: 0 } };
    expect(await (await GET(authed())).json()).toEqual({ ok: true, events: { claimed: 0 } });
  });

  it("500 générique (sans détail interne) en cas d'échec", async () => {
    state.fail = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await GET(authed());
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});
