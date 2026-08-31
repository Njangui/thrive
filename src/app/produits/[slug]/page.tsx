import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolveRequestTenant, buildWhatsAppLink } from "@/infrastructure/tenant/resolve-request-tenant";
import { getProductBySlug } from "@/application/services/catalog-service";

function formatPrice(amount: number): string {
  return `${amount.toLocaleString("fr-FR")} FCFA`;
}

const STATUS_LABELS: Record<string, { label: string; available: boolean }> = {
  active: { label: "Disponible", available: true },
  out_of_stock: { label: "Rupture de stock", available: false },
  draft: { label: "Bientôt disponible", available: false },
  inactive: { label: "Indisponible", available: false },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tenant = await resolveRequestTenant();
  if (!tenant) return {};

  const product = await getProductBySlug(tenant.organizationId, slug);
  if (!product) return {};

  return {
    title: `${product.name} — ${tenant.name}`,
    description: product.description ?? undefined,
    icons: tenant.faviconUrl ? { icon: tenant.faviconUrl } : undefined,
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await resolveRequestTenant();
  if (!tenant) notFound();

  const product = await getProductBySlug(tenant.organizationId, slug);
  if (!product) notFound();

  const statusInfo = STATUS_LABELS[product.status] ?? { label: product.status, available: false };
  const hasPromo = product.compareAtPrice !== null && product.compareAtPrice > product.unitPrice;

  const whatsappHref = tenant.whatsappNumber
    ? buildWhatsAppLink(
        tenant.whatsappNumber,
        `Bonjour, je suis intéressé(e) par "${product.name}" (${formatPrice(product.unitPrice)}).`,
      )
    : null;

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-5 py-10 sm:py-16">
      {product.images.length > 0 ? (
        <div className="flex flex-col gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={product.images[0]}
            alt={product.name}
            className="aspect-square w-full rounded-lg border border-ink/10 object-cover"
          />
          {product.images.length > 1 && (
            <div className="grid grid-cols-4 gap-2">
              {product.images.slice(1, 5).map((url) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={url}
                  src={url}
                  alt={product.name}
                  className="aspect-square w-full rounded border border-ink/10 object-cover"
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-ink/20 text-sm text-muted">
          Aucune photo pour ce produit
        </div>
      )}

      <div>
        {product.categoryName && (
          <span className="text-xs uppercase tracking-wide text-muted">{product.categoryName}</span>
        )}
        <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">{product.name}</h1>

        <div className="mt-3 flex items-baseline gap-3">
          <span className="font-display text-xl font-semibold text-leaf">
            {formatPrice(product.unitPrice)}
          </span>
          {hasPromo && (
            <span className="text-sm text-muted line-through">{formatPrice(product.compareAtPrice!)}</span>
          )}
          {hasPromo && (
            <span className="rounded-full bg-clay/10 px-2 py-0.5 text-xs font-medium text-clay">Promo</span>
          )}
        </div>

        <span
          className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
            statusInfo.available ? "bg-leaf/10 text-leaf" : "bg-ink/10 text-muted"
          }`}
        >
          {statusInfo.label}
        </span>

        {product.description && <p className="mt-4 text-sm text-ink/80">{product.description}</p>}
      </div>

      {whatsappHref && (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex w-fit items-center gap-2 rounded-brand px-5 py-3 font-medium text-white transition-opacity ${
            statusInfo.available ? "bg-leaf hover:opacity-90" : "bg-muted"
          }`}
        >
          {statusInfo.available ? "Commander sur WhatsApp" : "Nous contacter sur WhatsApp"}
        </a>
      )}
    </main>
  );
}
