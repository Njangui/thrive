import { test, expect } from "@playwright/test";

/**
 * Vérifie que les critères d'installabilité PWA sont réellement servis
 * par le navigateur (pas juste présents sur disque) — manifest lié et
 * valide, icônes atteignables, service worker qui s'enregistre. Ne
 * teste pas le contenu du cache (public/sw.js est un service worker
 * minimal assumé comme tel, voir son commentaire de tête — pas de
 * promesse offline complète à vérifier ici).
 */
test.describe("PWA", () => {
  test("le manifest est lié et valide", async ({ page, request }) => {
    await page.goto("/dashboard");

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
    expect(manifestHref).toBe("/manifest.json");

    const response = await request.get(manifestHref!);
    expect(response.ok()).toBe(true);

    const manifest = await response.json();
    expect(manifest.name).toBeTruthy();
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
    for (const icon of manifest.icons) {
      const iconResponse = await request.get(icon.src);
      expect(iconResponse.ok()).toBe(true);
    }
  });

  test("le service worker s'enregistre", async ({ page }) => {
    await page.goto("/dashboard");

    const registered = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const registration = await navigator.serviceWorker.ready.catch(() => null);
      return registration !== null;
    });

    expect(registered).toBe(true);
  });
});
