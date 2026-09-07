"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { checkDomainAvailabilityAction, type DomainSearchActionResult } from "./domain-search-actions";
import type { DomainAvailabilityResult } from "@/application/services/domain-service";

/**
 * Lot N, Partie 2 — recherche en direct (debounce 500ms) sur le champ
 * "Nom de domaine souhaité". Reste un simple <input name="domainName">
 * pour la soumission du formulaire parent (<form action={requestDomainAction}>,
 * dashboard/site/page.tsx) — ce composant n'ajoute qu'un affichage de
 * statut sous le champ, il ne remplace jamais la vraie action de
 * demande, qui reste server-side et fonctionne même si la recherche live
 * échoue (dégradation déjà gérée par domain-service.ts::checkDomainAvailability).
 */
export function DomainSearchField({ organizationId }: { organizationId: string }) {
  const [value, setValue] = useState("");
  const [results, setResults] = useState<DomainAvailabilityResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const label = value.trim().toLowerCase();
    if (!label) {
      setResults(null);
      setError(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const result: DomainSearchActionResult = await checkDomainAvailabilityAction(organizationId, label);
        if (result.ok) {
          setResults(result.results ?? []);
          setError(null);
        } else {
          setResults(null);
          setError(result.error ?? "Erreur lors de la vérification.");
        }
      });
    }, 500);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, organizationId]);

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col text-sm">
        Nom de domaine souhaité
        <input
          type="text"
          name="domainName"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\.[a-z]*$/i, ""))}
          placeholder="boutique-fatou"
          required
          className="mt-1 rounded-brand border border-ink/20 px-3 py-2 text-sm text-ink"
        />
      </label>

      {isPending && <p className="text-xs text-muted">Vérification en cours...</p>}

      {!isPending && error && <p className="text-xs text-clay">{error}</p>}

      {!isPending && !error && results && results.length > 0 && (
        <ul className="flex flex-col gap-1">
          {results.map((r) => (
            <li key={r.tld} className="flex items-center justify-between text-xs">
              <span className="font-mono text-ink">{r.domain}</span>
              {r.available === true && (
                <span className="text-leaf">
                  ✓ Disponible{r.priceFcfa !== null ? ` — ${r.priceFcfa.toLocaleString("fr-FR")} FCFA/an` : ""}
                </span>
              )}
              {r.available === false && <span className="text-clay">✗ Déjà pris</span>}
              {r.available === null && (
                <span className="text-muted">
                  Disponibilité non vérifiable{r.priceFcfa !== null ? ` — ${r.priceFcfa.toLocaleString("fr-FR")} FCFA/an` : ""}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
