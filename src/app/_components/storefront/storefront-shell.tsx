import type { ReactNode } from "react";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { getTenantBrandingStyle, resolveTenantFontClassName, resolveBrandRadius } from "@/lib/tenant-branding";
import { StorefrontHeader } from "./storefront-header";
import { StorefrontFooter } from "./storefront-footer";
import { WhatsappFab } from "./whatsapp-fab";
import { StorefrontPageTracker } from "./storefront-page-tracker";
import { Container } from "./storefront-ui";

/**
 * Enveloppe commune à TOUTES les pages de la vitrine d'un tenant.
 *
 * C'est le changement structurant de ce chantier : avant, `/` rendait ses
 * sections et `/produits` rendait sa liste, chacune avec son propre
 * conteneur, sa propre police, ses propres couleurs — et sans aucune
 * navigation entre les deux. Un visiteur arrivé sur une fiche produit
 * depuis WhatsApp n'avait littéralement aucun moyen de remonter vers le
 * reste de la boutique.
 *
 * Ici : barre d'annonce, en-tête avec menu, contenu, pied de page, bouton
 * WhatsApp flottant. Les variables de marque et la police sont posées une
 * seule fois, sur le conteneur racine, et héritées par tout le sous-arbre.
 */
export function StorefrontShell({ site, children, home = false }: { site: StorefrontSite; children: ReactNode; home?: boolean }) {
  const { tenant, config, blueprint, capabilities, announcement, whatsappHref, accent } = site;

  const brandingStyle = getTenantBrandingStyle(config, {
    fallbackAccent: accent,
    radius: resolveBrandRadius(config.visualStyle),
  });

  return (
    <div
      className={`sf-site flex min-h-screen flex-col bg-white ${resolveTenantFontClassName(config.fontChoice)}`}
      style={brandingStyle}
      data-sector={site.sector || "default"}
      data-visual-style={config.visualStyle}
    >
      <StorefrontPageTracker />
      {announcement && (
        <div className="sf-announcement bg-brand text-white">
          <Container className="py-2 text-center text-xs font-medium sm:text-sm">{announcement}</Container>
        </div>
      )}

      <StorefrontHeader
        businessName={tenant.name}
        logoUrl={tenant.logoUrl}
        nav={site.nav}
        whatsappHref={whatsappHref}
        // La recherche n'apparaît que s'il y a un catalogue à fouiller :
        // un champ de recherche qui ne peut rien trouver est une promesse
        // creuse (et le formulaire mènerait à une page de résultats vide).
        searchEnabled={capabilities.hasProducts}
        catalogHref="/produits"
        ctaLabel={site.sector === "restaurant" ? "Réserver une table" : blueprint.primaryCtaTarget === "booking" ? "Prendre RDV" : "Nous écrire"}
        homeOverlay={home && (site.sector === "" || site.sector === "restaurant" || site.sector === "real_estate" || site.sector === "retail" || site.sector === "beauty" || site.sector === "professional_services")}
      />

      <main id="contenu" className="flex-1">
        {children}
      </main>

      <StorefrontFooter site={site} />

      {whatsappHref && <WhatsappFab href={whatsappHref} organizationId={tenant.organizationId} />}
    </div>
  );
}
