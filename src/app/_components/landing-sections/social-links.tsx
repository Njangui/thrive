import type { TenantContext } from "@/infrastructure/tenant/resolve-request-tenant";

const KNOWN_PLATFORM_LABELS: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  twitter: "X (Twitter)",
  x: "X (Twitter)",
  youtube: "YouTube",
  whatsapp: "WhatsApp",
};

function labelFor(platformKey: string): string {
  return KNOWN_PLATFORM_LABELS[platformKey.toLowerCase()] ?? platformKey.charAt(0).toUpperCase() + platformKey.slice(1);
}

/** N'affiche que les clés dont la valeur est une URL non vide — `tenant.socialLinks` peut contenir des entrées vides saisies puis effacées côté dashboard. */
export function SocialLinksSection({ tenant }: { tenant: TenantContext }) {
  const entries = Object.entries(tenant.socialLinks).filter(([, url]) => url && url.trim().length > 0);
  if (entries.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-semibold">Suivez-nous</h2>
      <div className="flex flex-wrap gap-2">
        {entries.map(([platform, url]) => (
          <a
            key={platform}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-brand border border-ink/15 px-4 py-2 text-sm font-medium hover:border-brand/50 hover:text-brand"
          >
            {labelFor(platform)}
          </a>
        ))}
      </div>
    </section>
  );
}
