import type { ReactNode } from "react";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { getLandingSectionData } from "@/application/services/landing-config-service";
import type { Block, Page } from "@/domain/entities/site";
import type { LandingSectionType } from "@/domain/entities/landing";
import { AboutSection } from "../landing-sections/about";
import { ProductsSection } from "../landing-sections/products";
import { ServicesSection } from "../landing-sections/services";
import { CategoriesSection } from "../landing-sections/categories";
import { PromotionsSection } from "../landing-sections/promotions";
import { GallerySection } from "../landing-sections/gallery";
import { TestimonialsSection } from "../landing-sections/testimonials";
import { TeamSection } from "../landing-sections/team";
import { FaqSection } from "../landing-sections/faq";
import { ContactSection, LocationSection, SocialLinksSection } from "../landing-sections/contact";
import { Breadcrumbs, Container, PageHeader } from "./storefront-ui";
import { renderRichBlock } from "./rich-blocks";

/**
 * Page supplémentaire d'une version PUBLIÉE du site (C4). N'affiche que les
 * blocs visibles, dans l'ordre. Les blocs de données réutilisent les
 * composants de la vitrine : même rendu, mêmes données du tenant.
 *
 * Sécurité : le bloc `text` est du TEXTE BRUT rendu par React (échappé) —
 * aucun HTML, aucun script. Le titre de la page est l'unique H1.
 */
const DATA_TYPES = new Set<LandingSectionType>(["products", "services", "categories", "promotions", "gallery", "testimonials", "team", "faq"]);

function TextBlock({ heading, body }: { heading?: string; body: string }) {
  return (
    <Container className="py-8 sm:py-12">
      <div className="max-w-3xl">
        {heading && <h2 className="font-display text-2xl font-extrabold tracking-tight">{heading}</h2>}
        <p className={`${heading ? "mt-3" : ""} whitespace-pre-line text-base leading-8 text-black/70`}>{body}</p>
      </div>
    </Container>
  );
}

export async function BlockPage({ site, page, isHome = false }: { site: StorefrontSite; page: Page; isHome?: boolean }) {
  const blocks = page.blocks.filter((b) => b.visible);
  const dataTypes = [...new Set(blocks.map((b) => b.type).filter((t): t is LandingSectionType => DATA_TYPES.has(t as LandingSectionType)))];
  const entries = await Promise.all(dataTypes.map(async (type) => [type, await getLandingSectionData(site.tenant.organizationId, type)] as const));
  const data = new Map(entries);

  const render = (block: Block): ReactNode => {
    switch (block.type) {
      case "text":
        return <TextBlock key={block.id} heading={block.props.heading} body={block.props.body} />;
      case "about":
        return <AboutSection key={block.id} site={site} compact />;
      case "contact":
        return <ContactSection key={block.id} site={site} />;
      case "location":
        return <LocationSection key={block.id} site={site} />;
      case "social_links":
        return <SocialLinksSection key={block.id} site={site} />;
      case "products": {
        const d = data.get("products");
        return d?.type === "products" ? <ProductsSection key={block.id} products={d.products} site={site} /> : null;
      }
      case "services": {
        const d = data.get("services");
        return d?.type === "services" ? <ServicesSection key={block.id} services={d.services} site={site} hasBookingSection={false} /> : null;
      }
      case "categories": {
        const d = data.get("categories");
        return d?.type === "categories" ? <CategoriesSection key={block.id} categories={d.categories} site={site} /> : null;
      }
      case "promotions": {
        const d = data.get("promotions");
        return d?.type === "promotions" ? <PromotionsSection key={block.id} products={d.products} site={site} /> : null;
      }
      case "gallery": {
        const d = data.get("gallery");
        return d?.type === "gallery" ? <GallerySection key={block.id} images={d.images} site={site} /> : null;
      }
      case "testimonials": {
        const d = data.get("testimonials");
        return d?.type === "testimonials" ? <TestimonialsSection key={block.id} testimonials={d.testimonials} site={site} /> : null;
      }
      case "team": {
        const d = data.get("team");
        return d?.type === "team" ? <TeamSection key={block.id} members={d.members} site={site} /> : null;
      }
      case "faq": {
        const d = data.get("faq");
        return d?.type === "faq" ? <FaqSection key={block.id} faqs={d.faqs} site={site} /> : null;
      }
      default:
        // Blocs riches (site libre) ; hero, cta, booking : refusés par le schéma hors gabarit, jamais rendus ici.
        return renderRichBlock(block);
    }
  };

  // Un `rich_hero` visible porte déjà le H1 de la page : pas de second en-tête (une seule balise H1 par page).
  const hasOwnHero = blocks.some((b) => b.type === "rich_hero");
  return (
    <>
      {!isHome && !hasOwnHero && (
        <PageHeader eyebrow={site.blueprint.eyebrow} title={page.title}>
          <Breadcrumbs items={[{ label: "Accueil", href: "/" }, { label: page.title }]} />
        </PageHeader>
      )}
      {blocks.map(render)}
    </>
  );
}
