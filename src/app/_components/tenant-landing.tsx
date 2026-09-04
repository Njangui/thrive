import type { TenantContext } from "@/infrastructure/tenant/resolve-request-tenant";
import { getLandingConfig, getLandingSectionData, type LandingSectionData } from "@/application/services/landing-config-service";
import type { LandingSectionType } from "@/domain/entities/landing";
import { getTenantBrandingStyle, resolveTenantFontClassName } from "@/lib/tenant-branding";

import { HeroSection } from "./landing-sections/hero";
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
import { ContactSection } from "./landing-sections/contact";
import { LocationSection } from "./landing-sections/location";
import { SocialLinksSection } from "./landing-sections/social-links";
import { CtaSection } from "./landing-sections/cta";
import { FooterSection } from "./landing-sections/footer";

/** Types de section qui nécessitent une lecture DB dédiée via getLandingSectionData — les autres lisent directement `tenant` (déjà résolu par la page appelante), voir landing-config-service.ts. */
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
  tenant,
  bookingFeedback,
}: {
  tenant: TenantContext;
  bookingFeedback?: { success?: string; error?: string };
}) {
  // `tenant.industry` déjà résolu par resolveRequestTenant() — évite une
  // requête `organizations` redondante dans getLandingConfig (voir son
  // commentaire sur `knownIndustry`).
  const config = await getLandingConfig(tenant.organizationId, tenant.industry);

  const enabledSections = config.sections.filter((section) => section.enabled).sort((a, b) => a.order - b.order);

  const dbBackedSections = enabledSections.filter((section) => DB_BACKED_SECTION_TYPES.has(section.type));
  const dataEntries = await Promise.all(
    dbBackedSections.map(
      async (section) => [section.type, await getLandingSectionData(tenant.organizationId, section.type)] as const,
    ),
  );
  const dataByType = new Map<LandingSectionType, LandingSectionData | null>(dataEntries);

  const hasBookingSection = enabledSections.some((section) => section.type === "booking");

  const brandingStyle = getTenantBrandingStyle(config);
  const fontClassName = resolveTenantFontClassName(config.fontChoice);

  return (
    <div className={fontClassName} style={brandingStyle}>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-5 py-10 sm:py-16">
        {enabledSections.map((section) => {
          switch (section.type) {
            case "hero":
              return <HeroSection key="hero" tenant={tenant} />;
            case "about":
              return <AboutSection key="about" tenant={tenant} />;
            case "contact":
              return <ContactSection key="contact" tenant={tenant} />;
            case "location":
              return <LocationSection key="location" tenant={tenant} />;
            case "social_links":
              return <SocialLinksSection key="social_links" tenant={tenant} />;
            case "cta":
              return <CtaSection key="cta" tenant={tenant} />;
            case "products": {
              const data = dataByType.get("products");
              return data?.type === "products" ? <ProductsSection key="products" products={data.products} /> : null;
            }
            case "services": {
              const data = dataByType.get("services");
              return data?.type === "services" ? (
                <ServicesSection
                  key="services"
                  tenant={tenant}
                  services={data.services}
                  hasBookingSection={hasBookingSection}
                />
              ) : null;
            }
            case "categories": {
              const data = dataByType.get("categories");
              return data?.type === "categories" ? (
                <CategoriesSection key="categories" categories={data.categories} />
              ) : null;
            }
            case "promotions": {
              const data = dataByType.get("promotions");
              return data?.type === "promotions" ? (
                <PromotionsSection key="promotions" products={data.products} />
              ) : null;
            }
            case "gallery": {
              const data = dataByType.get("gallery");
              return data?.type === "gallery" ? <GallerySection key="gallery" images={data.images} /> : null;
            }
            case "testimonials": {
              const data = dataByType.get("testimonials");
              return data?.type === "testimonials" ? (
                <TestimonialsSection key="testimonials" testimonials={data.testimonials} />
              ) : null;
            }
            case "team": {
              const data = dataByType.get("team");
              return data?.type === "team" ? <TeamSection key="team" members={data.members} /> : null;
            }
            case "faq": {
              const data = dataByType.get("faq");
              return data?.type === "faq" ? <FaqSection key="faq" faqs={data.faqs} /> : null;
            }
            case "booking": {
              const data = dataByType.get("booking");
              return data?.type === "booking" ? (
                <BookingSection key="booking" tenant={tenant} services={data.services} feedback={bookingFeedback} />
              ) : null;
            }
            default:
              return null;
          }
        })}
      </main>
      <FooterSection tenant={tenant} />
    </div>
  );
}
