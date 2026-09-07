import type { TenantContext } from "@/infrastructure/tenant/resolve-request-tenant";

/**
 * "footer n'est pas une section activable — toujours présent (cohérence
 * de marque)" (cahier Lot K) : contrairement aux autres composants de ce
 * dossier, celui-ci n'est JAMAIS conditionné par
 * `organization_landing_config.sections` — `tenant-landing.tsx` le rend
 * inconditionnellement, en dehors de la boucle des sections activables.
 */
export function FooterSection({ tenant }: { tenant: TenantContext }) {
  return (
    <footer className="border-t border-ink/10 px-5 py-8 text-center text-xs text-muted">
      <p>
        © {new Date().getFullYear()} {tenant.name}
        {tenant.address ? ` — ${tenant.address}` : ""}
      </p>
      <p className="mt-1">
        Site propulsé par{" "}
        <a href="https://sme-os.app" className="font-medium hover:text-brand">
          SME-OS
        </a>
      </p>
    </footer>
  );
}
