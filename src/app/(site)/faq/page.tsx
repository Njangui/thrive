import type { Metadata } from "next";
import { listActiveFaqsForLanding } from "@/application/services/landing-config-service";
import { resolveCanonicalOrigin } from "@/infrastructure/tenant/resolve-request-tenant";
import { JsonLd } from "@/app/_components/json-ld";
import { STOREFRONT_PATHS } from "@/application/config/storefront-routes";
import { FaqList } from "@/app/_components/landing-sections/faq";
import { Container, EmptyState, PageHeader, Breadcrumbs } from "@/app/_components/storefront/storefront-ui";
import { requireStorefront, buildStorefrontMetadata, buildBreadcrumbJsonLd } from "../_lib/storefront-page";

export async function generateMetadata(): Promise<Metadata> {
  const site = await requireStorefront();
  return buildStorefrontMetadata({
    path: STOREFRONT_PATHS.faq,
    title: "Questions fréquentes",
    description: `Les réponses aux questions les plus posées à ${site.tenant.name}.`,
  });
}

export default async function FaqPage() {
  const site = await requireStorefront();
  const [faqs, origin] = await Promise.all([
    listActiveFaqsForLanding(site.tenant.organizationId),
    resolveCanonicalOrigin(),
  ]);

  // schema.org/FAQPage. Depuis 2023, Google ne réserve plus l'affichage
  // enrichi des questions/réponses qu'aux sites institutionnels et de santé :
  // pour une boutique, ce balisage n'ouvre plus de « rich result ». Il reste
  // valide et lisible par les autres moteurs et assistants ; on le garde
  // parce qu'il ne coûte que ce bloc, sans en attendre d'effet dans Google.
  const faqJsonLd =
    faqs.length > 0
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqs.map((faq) => ({
            "@type": "Question",
            name: faq.question,
            acceptedAnswer: { "@type": "Answer", text: faq.answer },
          })),
        }
      : null;

  const breadcrumbJsonLd = buildBreadcrumbJsonLd(origin, [
    { label: "Accueil", href: "/" },
    { label: "Questions fréquentes", href: STOREFRONT_PATHS.faq },
  ]);

  return (
    <>
      <JsonLd data={faqJsonLd} />
      <JsonLd data={breadcrumbJsonLd} />

      <PageHeader
        title="Questions fréquentes"
        description={`Tout ce qu'on nous demande le plus souvent chez ${site.tenant.name}.`}
      >
        <Breadcrumbs items={[{ label: "Accueil", href: "/" }, { label: "Questions fréquentes" }]} />
      </PageHeader>

      <Container className="py-8 sm:py-12">
        <div className="max-w-3xl">
          {faqs.length === 0 ? (
            <EmptyState
              title="Aucune question publiée pour le moment"
              description="Écrivez-nous directement, nous répondons rapidement."
              action={{ label: "Nous contacter", href: STOREFRONT_PATHS.contact }}
            />
          ) : (
            <FaqList faqs={faqs} />
          )}
        </div>
      </Container>
    </>
  );
}
