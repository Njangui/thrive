"use client";

import { useState } from "react";

/**
 * Média à la création d'un produit/service (catalogue) : choix entre
 * "Photos" (plusieurs à la fois, fichiers et/ou liens collés) et "Vidéo".
 *
 * Le nommage des champs Photos (`newImages` / `newImageUrls`) correspond
 * volontairement à celui déjà utilisé sur la fiche produit/service pour
 * ajouter des photos après coup (`resolveImagesFromFormData`,
 * `filesField: "newImages"`, `urlsField: "newImageUrls"`) — la Server
 * Action de création peut donc réutiliser cette même fonction telle quelle.
 *
 * La vidéo, elle, ne peut être proposée qu'une fois le produit/service créé
 * (elle doit se rattacher à un identifiant existant) : en mode "Vidéo", on
 * se contente de le signaler ici, et c'est la Server Action de création qui,
 * en lisant le champ caché `mediaMode`, redirige ensuite directement vers le
 * panneau vidéo de la fiche nouvellement créée plutôt que vers la liste.
 */
export function NewCatalogMediaField({ itemLabel = "produit" }: { itemLabel?: string }) {
  const [mode, setMode] = useState<"images" | "video">("images");

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-navy-900/10 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Photos ou vidéo</p>
        <div className="flex gap-1 text-xs">
          <button
            type="button"
            onClick={() => setMode("images")}
            aria-pressed={mode === "images"}
            className={`rounded-full px-3 py-1 transition-colors ${
              mode === "images" ? "bg-navy-900 text-white" : "bg-navy-900/5 text-slate-500 hover:bg-navy-900/10"
            }`}
          >
            Photos
          </button>
          <button
            type="button"
            onClick={() => setMode("video")}
            aria-pressed={mode === "video"}
            className={`rounded-full px-3 py-1 transition-colors ${
              mode === "video" ? "bg-navy-900 text-white" : "bg-navy-900/5 text-slate-500 hover:bg-navy-900/10"
            }`}
          >
            Vidéo
          </button>
        </div>
      </div>

      <input type="hidden" name="mediaMode" value={mode} />

      {mode === "images" ? (
        <>
          <label className="flex flex-col gap-1 text-sm">
            Importer des photos (plusieurs à la fois)
            <input
              type="file"
              name="newImages"
              multiple
              accept="image/*"
              className="text-sm text-slate-500 file:mr-3 file:rounded-xl file:border-0 file:bg-navy-900/5 file:px-3 file:py-2 file:text-sm file:font-medium"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Ou coller plusieurs liens (un par ligne)
            <textarea
              name="newImageUrls"
              rows={2}
              placeholder="https://exemple.com/photo1.jpg"
              className="rounded-xl border border-navy-900/10 px-4 py-3 text-sm outline-hidden focus:border-violet-400"
            />
          </label>
          <p className="text-xs text-slate-500">
            Optionnel — vous pourrez en ajouter, en retirer ou en réordonner plus tard depuis la fiche {itemLabel}.
          </p>
        </>
      ) : (
        <p className="text-xs text-slate-500">
          Le {itemLabel} sera d&apos;abord créé, puis vous arriverez directement sur sa fiche pour envoyer la vidéo
          (elle doit se rattacher à un {itemLabel} déjà existant).
        </p>
      )}
    </div>
  );
}
