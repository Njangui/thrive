const PHASES = [
  { label: "Phase 1 — Architecture, base de données", status: "in_progress" },
  { label: "Phase 2 — Business / auth / multi-tenant / RLS", status: "in_progress" },
  { label: "Phase 3 — Catalogue / produits / services / stock", status: "done" },
  { label: "Phase 4 — Landing dynamique", status: "done" },
  { label: "Phase 5 — CRM / contacts", status: "done" },
  { label: "Phase 6 — Conversations", status: "done" },
  { label: "Phase 7 — FAQ", status: "done" },
  { label: "Phase 8 — Conversation Orchestrator", status: "done" },
  { label: "Phase 9 — Zernio WhatsApp", status: "done" },
  { label: "Phase 10 — Product Discovery WhatsApp", status: "done" },
  { label: "Phase 11 — IA contrôlée", status: "done" },
  { label: "Phase 12 — Human Handoff", status: "done" },
  { label: "Phase 13 — Commandes", status: "done" },
  { label: "Phase 14 — Finance", status: "done" },
  { label: "Phase 15 — Marketing / Zernio social publishing", status: "todo" },
  { label: "Phase 16 — Bulk product selection / campaigns", status: "todo" },
  { label: "Phase 17 — Analytics", status: "todo" },
  { label: "Phase 18 — Tests / sécurité / optimisation", status: "todo" },
] as const;

const STATUS_STYLES: Record<string, string> = {
  done: "bg-emerald-100 text-emerald-800",
  in_progress: "bg-amber-100 text-amber-800",
  todo: "bg-ink/10 text-muted",
};

const STATUS_LABELS: Record<string, string> = {
  done: "Squelette posé",
  in_progress: "En cours",
  todo: "À faire",
};

/**
 * Cette page n'est PAS une landing tenant — elle ne s'affiche que sur le
 * domaine racine (aucun tenant résolu par le middleware). Statut de dev
 * interne, non testé tant que la vérification finale n'a pas eu lieu.
 */
export function InternalStatus() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-5 py-10 sm:py-16">
      <header>
        <p className="font-display text-sm font-medium text-leaf">SME-OS · scaffold interne</p>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Fondation multi-tenant — état d&apos;avancement
        </h1>
        <p className="mt-2 text-sm text-muted">
          Cette page n&apos;est visible que sur le domaine racine. Sur un sous-domaine tenant
          (ou un domaine custom), c&apos;est la landing catalogue (section 12) qui s&apos;affiche ici.
        </p>
      </header>

      <ol className="flex flex-col gap-2">
        {PHASES.map((phase, i) => (
          <li
            key={phase.label}
            className="flex items-start justify-between gap-3 rounded-brand border border-ink/10 bg-white px-4 py-3"
          >
            <span className="text-sm text-ink">
              <span className="mr-2 text-muted">{String(i + 1).padStart(2, "0")}</span>
              {phase.label}
            </span>
            <span
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[phase.status]}`}
            >
              {STATUS_LABELS[phase.status]}
            </span>
          </li>
        ))}
      </ol>
    </main>
  );
}
