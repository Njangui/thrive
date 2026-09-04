import type { TenantContext } from "@/infrastructure/tenant/resolve-request-tenant";

/** Rend `null` sans description — jamais un encart vide (voir mandat de vague, pas de rendu décoratif). */
export function AboutSection({ tenant }: { tenant: TenantContext }) {
  if (!tenant.description) return null;

  return (
    <section className="flex flex-col gap-3 border-l-2 border-brand pl-5">
      <h2 className="font-display text-lg font-semibold">À propos de {tenant.name}</h2>
      <p className="whitespace-pre-line text-muted">{tenant.description}</p>
    </section>
  );
}
