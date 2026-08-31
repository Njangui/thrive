"use client";

import { useState } from "react";

/**
 * Champ image mixte (cahier Lot E, Partie 1) : upload de fichier réel PAR
 * DÉFAUT, avec bascule vers "coller un lien" pour les commerçants qui ont
 * déjà leurs images hébergées ailleurs — la flexibilité existante n'est
 * pas retirée, seulement complétée.
 *
 * Rend toujours les deux `<input>` dans le DOM (un seul visible selon
 * l'onglet actif) pour ne jamais perdre un fichier déjà sélectionné en
 * changeant d'onglet. Le nommage des champs (`${name}File` / `${name}Url`)
 * doit correspondre à `fileField`/`urlField` passés à
 * `resolveImageFromFormData` côté serveur (application/services/media-service.ts).
 */
export function ImageUploadField({
  name,
  label,
  currentUrl,
  helpText,
}: {
  name: string;
  label: string;
  currentUrl?: string | null;
  helpText?: string;
}) {
  const [mode, setMode] = useState<"upload" | "url">("upload");
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl ?? null);

  return (
    <div className="flex flex-col gap-3 rounded-brand border border-ink/15 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        <div className="flex gap-1 text-xs">
          <button
            type="button"
            onClick={() => setMode("upload")}
            aria-pressed={mode === "upload"}
            className={`rounded-full px-3 py-1 transition-colors ${
              mode === "upload" ? "bg-ink text-white" : "bg-ink/5 text-muted hover:bg-ink/10"
            }`}
          >
            Importer une photo
          </button>
          <button
            type="button"
            onClick={() => setMode("url")}
            aria-pressed={mode === "url"}
            className={`rounded-full px-3 py-1 transition-colors ${
              mode === "url" ? "bg-ink text-white" : "bg-ink/5 text-muted hover:bg-ink/10"
            }`}
          >
            Lien existant
          </button>
        </div>
      </div>

      {previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt=""
          className="h-24 w-24 rounded-brand border border-ink/10 object-cover"
        />
      )}

      <input
        type="file"
        name={`${name}File`}
        accept="image/*"
        className={mode === "upload" ? "text-sm text-muted file:mr-3 file:rounded-brand file:border-0 file:bg-ink/5 file:px-3 file:py-2 file:text-sm file:font-medium" : "hidden"}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => setPreviewUrl(String(reader.result));
          reader.readAsDataURL(file);
        }}
      />

      <input
        type="url"
        name={`${name}Url`}
        placeholder="https://..."
        defaultValue={currentUrl ?? ""}
        onChange={(event) => setPreviewUrl(event.target.value || currentUrl || null)}
        className={mode === "url" ? "rounded-brand border border-ink/15 px-4 py-3 text-sm outline-none focus:border-leaf" : "hidden"}
      />

      {helpText && <p className="text-xs text-muted">{helpText}</p>}
    </div>
  );
}
