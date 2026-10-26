import { describe, it, expect } from "vitest";
import { hasSitePublishRight, canEditSiteDraft } from "./site-permissions";

describe("hasSitePublishRight", () => {
  it("owner et admin publient par défaut", () => {
    expect(hasSitePublishRight("owner", {})).toBe(true);
    expect(hasSitePublishRight("admin", {})).toBe(true);
  });

  it("le propriétaire peut l'accorder à n'importe quel rôle via extra_permissions", () => {
    for (const role of ["manager", "employee", "employee", "employee", "employee"]) {
      expect(hasSitePublishRight(role, { publish_site: true })).toBe(true);
      expect(hasSitePublishRight(role, {})).toBe(false);
    }
  });

  it("seule la valeur booléenne true accorde le droit", () => {
    for (const bad of ["true", 1, "yes", { x: 1 }, null, [], false, undefined]) {
      expect(hasSitePublishRight("employee", { publish_site: bad })).toBe(false);
    }
    expect(hasSitePublishRight("employee", null)).toBe(false);
    expect(hasSitePublishRight("employee", ["publish_site"])).toBe(false);
    expect(hasSitePublishRight("employee", "publish_site")).toBe(false);
  });

  it("une autre permission n'ouvre pas la publication", () => {
    expect(hasSitePublishRight("manager", { manage_ai: true })).toBe(false);
  });
});

describe("canEditSiteDraft", () => {
  it("owner/admin/manager éditent ; employé non, sauf droit de publier accordé", () => {
    expect(canEditSiteDraft("manager", {})).toBe(true);
    expect(canEditSiteDraft("employee", {})).toBe(false);
    expect(canEditSiteDraft("employee", { publish_site: true })).toBe(true);
  });
});
