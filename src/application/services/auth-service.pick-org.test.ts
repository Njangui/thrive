import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/infrastructure/supabase/server-session-client", () => ({ getSupabaseServerSessionClient: vi.fn() }));
vi.mock("@/infrastructure/supabase/server-client", () => ({ getSupabaseServiceClient: vi.fn() }));

import { pickCurrentOrganization } from "./auth-service";

const free = { organizationId: "org-free", organizationName: "Test gratuit", role: "owner" as const };
const paid = { organizationId: "org-paid", organizationName: "Boutique payante", role: "owner" as const };

describe("pickCurrentOrganization", () => {
  it("aucune entreprise : undefined", () => expect(pickCurrentOrganization([], "x")).toBeUndefined());
  it("sans préférence : la plus ancienne (1re de la liste triée)", () => expect(pickCurrentOrganization([free, paid])).toBe(free));
  it("préférence valide : l'entreprise payante choisie", () => expect(pickCurrentOrganization([free, paid], "org-paid")).toBe(paid));
  it("SÉCURITÉ : une préférence vers une entreprise dont on n'est pas membre est ignorée", () => {
    expect(pickCurrentOrganization([free, paid], "org-etrangere")).toBe(free);
  });
  it("préférence vide ou null : repli sur la 1re", () => {
    expect(pickCurrentOrganization([free, paid], "")).toBe(free);
    expect(pickCurrentOrganization([free, paid], null)).toBe(free);
  });
});
