import Link from "next/link";

const TABS: { key: string; href: string; label: string }[] = [
  { key: "affiliates", href: "/admin/affiliates", label: "Affiliés" },
  { key: "payouts", href: "/admin/affiliates/payouts", label: "Paiements" },
  { key: "fraud", href: "/admin/affiliates/fraud", label: "Fraude" },
  { key: "settings", href: "/admin/affiliates/settings", label: "Réglages" },
];

export function AffiliatesSubNav({ active }: { active: string }) {
  return (
    <div className="flex gap-1 border-b border-ink/10">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`px-3 py-2 text-sm font-medium ${
            active === tab.key ? "border-b-2 border-violet-600 text-violet-600" : "text-ink/60 hover:text-ink"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
