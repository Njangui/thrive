"use client";

import { useState } from "react";
import { Icon } from "../_components/icons";

/**
 * Plateformes CONFIRMÉES quelque part dans ce projet (types.ts,
 * social-publishing-provider.ts, docs/ZERNIO_INTEGRATION.md) — pas de
 * plateforme inventée au-delà de ce que le code/la doc mentionne déjà.
 */
const PLATFORMS: { value: string; label: string }[] = [
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "threads", label: "Threads" },
  { value: "x", label: "X (Twitter)" },
  { value: "reddit", label: "Reddit" },
  { value: "bluesky", label: "Bluesky" },
];

/**
 * Aucune API de listing de comptes connectés n'existe dans ce projet (les
 * comptes sociaux sont connectés côté Zernio lui-même, hors de SME-OS — voir
 * `admin/channels/page.tsx`) : l'ID de compte est donc saisi à la main,
 * comme `SocialPostTarget.accountId` le documente déjà.
 */
export function TargetRowsField() {
  const [rows, setRows] = useState<string[]>([crypto.randomUUID()]);

  return (
    <div className="flex flex-col gap-2">
      {rows.map((rowId, i) => (
        <div key={rowId} className="flex items-center gap-2">
          <select
            name="targetPlatform"
            required
            defaultValue={PLATFORMS[0]?.value}
            className="rounded-lg border border-ink/15 px-3 py-2 text-sm"
          >
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            name="targetAccountId"
            required
            placeholder="ID du compte connecté"
            className="flex-1 rounded-lg border border-ink/15 px-3 py-2 text-sm"
          />
          {rows.length > 1 && (
            <button
              type="button"
              onClick={() => setRows((r) => r.filter((id) => id !== rowId))}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-danger-light hover:text-danger"
              aria-label="Retirer cette cible"
            >
              <Icon name="close" className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        onClick={() => setRows((r) => [...r, crypto.randomUUID()])}
        className="flex w-fit items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-primary hover:bg-primary-light"
      >
        <Icon name="plus" className="h-4 w-4" />
        Ajouter une cible
      </button>
    </div>
  );
}
