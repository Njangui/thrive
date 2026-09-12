import { test, expect } from "@playwright/test";

/**
 * Vérifie la garde d'authentification en boîte noire (navigateur réel,
 * sans session) — complémentaire aux tests unitaires de
 * `requireCurrentOrganization`/`requirePlatformAdmin` (mockés) : ceux-ci
 * prouvent que la fonction lève la bonne erreur, ceci prouve que la
 * redirection HTTP réelle a bien lieu de bout en bout.
 */
test.describe("Garde d'authentification", () => {
  test("la page de connexion est accessible sans session", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login/);
  });

  test("/dashboard redirige vers /login sans session", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("/admin redirige vers /login sans session", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
  });
});
