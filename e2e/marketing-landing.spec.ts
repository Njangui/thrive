import { test, expect } from "@playwright/test";

/**
 * Parcours public non-authentifié — pas de dépendance à un compte de
 * test, exécutable contre n'importe quel projet Supabase configuré
 * (même vide), du moment qu'au moins un plan existe dans `plans` (sinon
 * voir le test "affiche un message si aucune offre" ci-dessous, qui
 * couvre aussi ce cas).
 */
test.describe("Landing marketing", () => {
  test("charge et affiche le contenu principal", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /essayer gratuitement/i }).first()).toBeVisible();
  });

  test("la navigation par ancre défile vers les bonnes sections", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: "Tarifs" }).first().click();
    await expect(page.locator("#tarifs")).toBeInViewport();

    await page.getByRole("link", { name: "FAQ" }).first().click();
    await expect(page.locator("#faq")).toBeInViewport();
  });

  test("la section tarifs affiche au moins une offre ou un message d'attente", async ({ page }) => {
    await page.goto("/");
    const pricingSection = page.locator("#tarifs");

    const hasPlanCard = await pricingSection.getByRole("link", { name: /commencer/i }).first().isVisible().catch(() => false);
    const hasEmptyState = await pricingSection.getByText(/bientôt disponibles/i).isVisible().catch(() => false);

    expect(hasPlanCard || hasEmptyState).toBe(true);
  });

  test("le lien Connexion mène à la page de connexion", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Connexion" }).first().click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("le menu mobile s'ouvre et propose les mêmes ancres", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Le bouton menu burger n'est rendu que sous le breakpoint md (voir marketing-mobile-menu.tsx)");
    await page.goto("/");

    await page.getByRole("button", { name: /menu/i }).click();
    await expect(page.getByRole("link", { name: "Fonctionnalités" })).toBeVisible();
  });
});
