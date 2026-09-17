import type { Metadata } from "next";
import { listActiveFaqsForLanding } from "@/application/services/landing-config-service";
import { resolveRequestOrigin } from "@/infrastructure/tenant/resolve-request-tenant";
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
    resolveRequestOrigin(),
  ]);

  // schema.org/FAQPage : c'est ce balisage qui permet aux réponses
  // d'apparaître directement dans les résultats Google. Pour une PME sans
  // budget publicitaire, c'est l'une des rares surfaces gratuites
  // réellement atteignables — et elle ne coûte que ce bloc.
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
      {faqJsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />

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
