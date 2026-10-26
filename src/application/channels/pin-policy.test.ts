import { describe, it, expect } from "vitest";
import { validatePinFormat } from "./pin-policy";

describe("validatePinFormat", () => {
  it("accepte un PIN de 6 à 8 chiffres non trivial", () => {
    expect(validatePinFormat("493817")).toEqual({ ok: true });
    expect(validatePinFormat("20481937")).toEqual({ ok: true });
  });

  it.each(["1234", "12345", "123456789", "12a456", "", "12 456"])("refuse le format invalide %j", (pin) => {
    expect(validatePinFormat(pin)).toEqual({ ok: false, error: "format" });
  });

  it.each(["000000", "111111", "123456", "654321", "234567", "121212", "123123", "12341234"])(
    "refuse le PIN trivial %s",
    (pin) => {
      expect(validatePinFormat(pin)).toEqual({ ok: false, error: "too_weak" });
    },
  );
});
