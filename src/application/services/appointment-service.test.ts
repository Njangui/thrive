import { describe, it, expect } from "vitest";
import { assertValidAppointmentWindow } from "./appointment-service";

describe("assertValidAppointmentWindow", () => {
  it("accepte une fenêtre valide (fin après début)", () => {
    expect(() =>
      assertValidAppointmentWindow("2026-09-01T09:00:00+01:00", "2026-09-01T09:30:00+01:00"),
    ).not.toThrow();
  });

  it("rejette une fin avant le début", () => {
    expect(() =>
      assertValidAppointmentWindow("2026-09-01T10:00:00+01:00", "2026-09-01T09:00:00+01:00"),
    ).toThrow(/après/);
  });

  it("rejette une fin égale au début (durée nulle)", () => {
    expect(() =>
      assertValidAppointmentWindow("2026-09-01T09:00:00+01:00", "2026-09-01T09:00:00+01:00"),
    ).toThrow(/après/);
  });

  it("rejette une date invalide", () => {
    expect(() => assertValidAppointmentWindow("pas-une-date", "2026-09-01T09:00:00+01:00")).toThrow(
      /invalide/,
    );
  });
});
