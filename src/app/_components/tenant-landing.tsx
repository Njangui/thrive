import { Fragment } from "react";
import type { StorefrontSite } from "@/application/services/storefront-service";
import { listActiveStorefrontVideos } from "@/application/services/catalog-video-service";
import { getLandingSectionData, type LandingSectionData } from "@/application/services/landing-config-service";
import type { LandingSectionType } from "@/domain/entities/landing";

import { HeroSection, StatsBand } from "./landing-sections/hero";
import { AboutSection } from "./landing-sections/about";
import { ProductsSection } from "./landing-sections/products";
import { ServicesSection } from "./landing-sections/services";
import { CategoriesSection } from "./landing-sections/categories";
import { PromotionsSection } from "./landing-sections/promotions";
import { GallerySection } from "./landing-sections/gallery";
import { TestimonialsSection } from "./landing-sections/testimonials";
import { TeamSection } from "./landing-sections/team";
import { FaqSection } from "./landing-sections/faq";
import { BookingSection } from "./landing-sections/booking";
import { ContactSection, LocationSection, SocialLinksSection } from "./landing-sections/contact";
import { CtaSection } from "./landing-sections/cta";
import { VideosSection } from "./landing-sections/videos";

/**
 * Composition de la PAGE D'ACCUEIL de la vitrine.
 *
 * Ce composant ne gère plus ni l'en-tête, ni le pied de page, ni les
 * couleurs, ni la police : tout ça appartient désormais à
 * `StorefrontShell`, qui enveloppe TOUTES les pages du site. Ici on ne
 * fait qu'assembler les sections choisies par le commerçant, dans son
 * ordre — c'est-à-dire le seul travail que ce fichier aurait toujours dû
 * faire.
 *
 * La bande de chiffres (`StatsBand`) est insérée juste après l'en-tête
 * plutôt que d'être une section activable de plus : elle n'a de sens
 * qu'à cet endroit, et son affichage est déjà conditionné à l'existence
 * de chiffres réels (voir getStorefrontStats).
 */
const DB_BACKED_SECTION_TYPES = new Set<LandingSectionType>([
  "products",
  "services",
  "categories",
  "promotions",
  "gallery",
  "testimonials",
  "team",
  "faq",
  "booking",
]);

export async function TenantLanding({
  site,
  bookingFeedback,
}: {
  site: StorefrontSite;
  bookingFeedback?: { success?: string; error?: string };
}) {
  const { tenant, enabledSections } = site;

  // Chargements en parallèle : une section lente ne retarde pas les
  // autres. Les sections purement basées sur le `TenantContext` déjà
  // résolu (hero, about, contact, location, social_links, cta) ne
  // déclenchent aucune requête supplémentaire.
  const dbBackedSections = enabledSections.filter((type) => DB_BACKED_SECTION_TYPES.has(type));
  const dataEntries = await Promise.all(
    dbBackedSections.map(
      async (type) => [type, await getLandingSectionData(tenant.organizationId, type)] as const,
    ),
  );
  const dataByType = new Map<LandingSectionType, LandingSectionData | null>(dataEntries);

  // Vidéos du catalogue : affichées automatiquement (pas une section à activer)
  // tant qu'il en existe de NON EXPIRÉES — Zernio supprime les fichiers après
  // 7 jours. Insérées après la première section « visuelle » présente.
  const videos = await listActiveStorefrontVideos(tenant.organizationId, { limit: 3 });
  const videosAnchor = (["products", "gallery", "services", "hero"] as const).find((type) => enabledSections.includes(type));

  const hasBookingSection = enabledSections.includes("booking");

  return (
    <>
      {enabledSections.map((type) => {
        const section = (() => {
        switch (type) {
          case "hero":
            return (
              <div key="hero">
                <HeroSection site={site} />
                <StatsBand site={site} />
              </div>
            );
          case "about":
            return <AboutSection key="about" site={site} compact />;
          case "contact":
            return <ContactSection key="contact" site={site} />;
          case "location":
            return <LocationSection key="location" site={site} />;
          case "social_links":
            return <SocialLinksSection key="social_links" site={site} />;
          case "cta":
            return <CtaSection key="cta" site={site} />;
          case "products": {
            const data = dataByType.get("products");
            return data?.type === "products" ? (
              <ProductsSection key="products" products={data.products} site={site} />
            ) : null;
          }
          case "services": {
            const data = dataByType.get("services");
            return data?.type === "services" ? (
              <ServicesSection key="services" services={data.services} site={site} hasBookingSection={hasBookingSection} />
            ) : null;
          }
          case "categories": {
            const data = dataByType.get("categories");
            return data?.type === "categories" ? (
              <CategoriesSection key="categories" categories={data.categories} site={site} />
            ) : null;
          }
          case "promotions": {
            const data = dataByType.get("promotions");
            return data?.type === "promotions" ? (
              <PromotionsSection key="promotions" products={data.products} site={site} />
            ) : null;
          }
          case "gallery": {
            const data = dataByType.get("gallery");
            return data?.type === "gallery" ? <GallerySection key="gallery" images={data.images} site={site} /> : null;
          }
          case "testimonials": {
            const data = dataByType.get("testimonials");
            return data?.type === "testimonials" ? (
              <TestimonialsSection key="testimonials" testimonials={data.testimonials} site={site} />
            ) : null;
          }
          case "team": {
            const data = dataByType.get("team");
            return data?.type === "team" ? <TeamSection key="team" members={data.members} site={site} /> : null;
          }
          case "faq": {
            const data = dataByType.get("faq");
            return data?.type === "faq" ? <FaqSection key="faq" faqs={data.faqs} site={site} /> : null;
          }
          case "booking": {
            const data = dataByType.get("booking");
            return data?.type === "booking" ? (
              <BookingSection key="booking" site={site} services={data.services} feedback={bookingFeedback} />
            ) : null;
          }
          default:
            return null;
        }
        })();

        return type === videosAnchor && videos.length > 0 ? (
          <Fragment key={`${type}-with-videos`}>
            {section}
            <VideosSection videos={videos} site={site} />
          </Fragment>
        ) : (
          section
        );
      })}
    </>
  );
}
