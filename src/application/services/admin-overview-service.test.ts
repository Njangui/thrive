import { describe, it, expect, vi } from "vitest";

vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: vi.fn() }));

import { summarizeSubscriptions } from "./admin-overview-service";

const org = (id: string, status = "active") => ({ id, status });
const sub = (organization_id: string, plan_key: string, status = "active") => ({ organization_id, plan_key, status });

describe("summarizeSubscriptions — freemium (plan d'entrée `free`, plus d'essai)", () => {
  it("compte les organisations gratuites, et NON comme « abonnées »", () => {
    const r = summarizeSubscriptions([org("a"), org("b")], [sub("a", "free"), sub("b", "free")]);
    expect(r).toMatchObject({ active: 2, free: 2, subscribed: 0, suspended: 0 });
    expect(r.breakdown).toEqual({ paid: 0, free: 2, suspended: 0, other: 0 });
  });

  it("compte un client Starter (payant) comme abonné — l'ancienne règle « plan ≠ starter » l'ignorait", () => {
    const r = summarizeSubscriptions([org("a"), org("b")], [sub("a", "starter"), sub("b", "pro")]);
    expect(r).toMatchObject({ active: 2, free: 0, subscribed: 2 });
    expect(r.breakdown.paid).toBe(2);
  });

  it("un abonnement payant impayé ou résilié ne compte pas comme « abonné » (qui paie MAINTENANT)", () => {
    const r = summarizeSubscriptions(
      [org("a"), org("b")],
      [sub("a", "pro", "past_due"), sub("b", "starter", "cancelled")],
    );
    expect(r).toMatchObject({ active: 0, free: 0, subscribed: 0 });
    expect(r.breakdown).toEqual({ paid: 0, free: 0, suspended: 0, other: 2 });
  });

  it("une organisation suspendue est comptée dans « suspendues » et exclusivement dans cette part du donut", () => {
    const r = summarizeSubscriptions([org("a", "suspended"), org("b")], [sub("a", "pro"), sub("b", "free")]);
    expect(r.suspended).toBe(1);
    // compteurs qui se chevauchent : la suspendue reste « active » et « abonnée »…
    expect(r).toMatchObject({ active: 2, subscribed: 1, free: 1 });
    // …mais le donut est mutuellement exclusif (somme = nombre d'organisations)
    expect(r.breakdown).toEqual({ paid: 0, free: 1, suspended: 1, other: 0 });
    const total = Object.values(r.breakdown).reduce((x, y) => x + y, 0);
    expect(total).toBe(2);
  });

  it("sans ligne d'abonnement (créée avant Lot B) ou en ancien essai : ni gratuite ni abonnée → « autres »", () => {
    const r = summarizeSubscriptions([org("a"), org("b")], [sub("b", "starter", "trialing")]);
    expect(r).toMatchObject({ active: 0, free: 0, subscribed: 0 });
    expect(r.breakdown).toEqual({ paid: 0, free: 0, suspended: 0, other: 2 });
  });

  it("le donut s'additionne toujours au nombre total d'organisations", () => {
    const orgs = [org("1"), org("2"), org("3", "suspended"), org("4"), org("5")];
    const subs = [sub("1", "free"), sub("2", "pro"), sub("3", "starter"), sub("4", "starter", "past_due")];
    const r = summarizeSubscriptions(orgs, subs);
    expect(Object.values(r.breakdown).reduce((x, y) => x + y, 0)).toBe(orgs.length);
  });

  it("aucune organisation → tout à zéro", () => {
    expect(summarizeSubscriptions([], [])).toEqual({
      active: 0,
      free: 0,
      subscribed: 0,
      suspended: 0,
      breakdown: { paid: 0, free: 0, suspended: 0, other: 0 },
    });
  });
});
