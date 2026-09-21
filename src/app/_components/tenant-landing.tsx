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
import { BeautyHome, DefaultBusinessHome, ProfessionalServicesHome, RealEstateHome, RestaurantHome, RetailHome } from "./sector-home";

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
  // Le template restaurant utilise aussi une photo de plat réelle comme
  // fallback du hero lorsqu'aucune bannière n'a encore été configurée.
  // On charge donc le catalogue même si la section « produits » n'est pas
  // affichée sur la home par défaut.
  const specialTemplateTypes = ["", "restaurant", "retail", "beauty", "professional_services"].includes(site.sector)
    ? (site.sector === "beauty" || site.sector === "professional_services"
        ? ["services", "categories", "team", "testimonials"]
        : site.sector === ""
          ? ["products", "categories", "services", "gallery", "testimonials", "team"]
          : ["products", "categories", "testimonials", ...(site.sector === "retail" ? ["promotions"] : [])]) as LandingSectionType[]
    : [];
  const dataTypes = specialTemplateTypes.length
    ? Array.from(new Set([...dbBackedSections, ...specialTemplateTypes]))
    : dbBackedSections;
  const dataEntries = await Promise.all(
    dataTypes.map(
      async (type) => [type, await getLandingSectionData(tenant.organizationId, type)] as const,
    ),
  );
  const dataByType = new Map<LandingSectionType, LandingSectionData | null>(dataEntries);

  // Vidéos du catalogue : affichées automatiquement (pas une section à activer)
  // tant qu'il en existe de NON EXPIRÉES — Zernio supprime les fichiers après
  // 7 jours. Insérées après la première section « visuelle » présente.
  const videos = await listActiveStorefrontVideos(tenant.organizationId, { limit: 3 });
  const videosAnchor = (["products", "gallery", "services", "hero"] as const).find((type) => enabledSections.includes(type));

  const hasBookingSection = enabledSections.includes("booking") && site.capabilities.bookingEnabled;

  // Les vitrines sectorielles sont des templates complets :
  // on conserve les mêmes données dynamiques, mais la composition, les
  // proportions, l’ordre visuel et les traitements graphiques suivent
  // volontairement les maquettes fournies. Les réglages de contenu restent
  // prioritaires ; un reset revient à ces compositions par défaut.
  const blueprintSections = site.blueprint.sections;
  const usesDefaultSectorComposition =
    site.enabledSections.length === blueprintSections.length &&
    site.enabledSections.every((section, index) => section === blueprintSections[index]);

  // Les templates sectoriels sont le mode « design de base ». Dès que le
  // commerçant modifie réellement la structure (activation/désactivation ou
  // ordre), on repasse par le compositeur générique plus bas : il respecte
  // alors exactement les choix du Site Builder au lieu de les ignorer. Les
  // personnalisations de couleurs, textes, images et identité continuent
  // quant à elles d'utiliser le template sectoriel.
  if (usesDefaultSectorComposition && (site.sector === "" || site.sector === "real_estate" || site.sector === "restaurant" || site.sector === "retail" || site.sector === "beauty" || site.sector === "professional_services")) {
    const productData = dataByType.get("products");
    const categoryData = dataByType.get("categories");
    const serviceData = dataByType.get("services");
    const testimonialData = dataByType.get("testimonials");
    const promotionData = dataByType.get("promotions");
    const products = productData?.type === "products" ? productData.products : [];
    const categories = categoryData?.type === "categories" ? categoryData.categories : [];
    const services = serviceData?.type === "services" ? serviceData.services : [];
    const testimonials = testimonialData?.type === "testimonials" ? testimonialData.testimonials : [];
    const promotions = promotionData?.type === "promotions" ? promotionData.products : [];
    const galleryData = dataByType.get("gallery");
    const teamData = dataByType.get("team");
    const gallery = galleryData?.type === "gallery" ? galleryData.images : [];
    const team = teamData?.type === "team" ? teamData.members : [];

    if (site.sector === "") {
      return <DefaultBusinessHome site={site} products={products} categories={categories} services={services} testimonials={testimonials} />;
    }
    if (site.sector === "beauty") {
      return <BeautyHome site={site} services={services} gallery={gallery} testimonials={testimonials} team={team} />;
    }
    if (site.sector === "professional_services") {
      return <ProfessionalServicesHome site={site} services={services} categories={categories} testimonials={testimonials} team={team} />;
    }
    if (site.sector === "real_estate") {
      return <RealEstateHome site={site} products={products} categories={categories} services={services} testimonials={testimonials} />;
    }
    if (site.sector === "restaurant") {
      return <RestaurantHome site={site} categories={categories} testimonials={testimonials} />;
    }
    return <RetailHome site={site} products={products} categories={categories} promotions={promotions} testimonials={testimonials} />;
  }

  return (
    <>
      {enabledSections.map((type) => {
        const section = (() => {
        switch (type) {
          case "hero": {
            const productData = dataByType.get("products");
            const heroFallbackImage = productData?.type === "products" ? productData.products[0]?.imageUrl ?? null : null;
            return (
              <div key="hero">
                <HeroSection site={site} fallbackMediaUrl={heroFallbackImage} />
                {site.sector !== "restaurant" && <StatsBand site={site} />}
              </div>
            );
          }
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
            if (!site.capabilities.bookingEnabled) return null;
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
