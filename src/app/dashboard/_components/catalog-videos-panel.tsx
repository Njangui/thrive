"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CatalogVideo } from "@/application/services/catalog-video-service";
import { deleteVideoAction, registerVideoAction, requestVideoUploadAction } from "../_actions/catalog-video-actions";

/**
 * Panneau « Vidéos » d'une fiche produit ou service.
 *
 * Le fichier part du navigateur DIRECTEMENT vers Zernio (URL présignée) :
 * pas de limite de 4,5 Mo de fonction Vercel, pas de bande passante
 * serveur. Zernio ne conserve les vidéos que 7 JOURS — le bandeau
 * ci-dessous l'annonce à l'utilisateur AVANT l'envoi, et chaque vidéo
 * affiche son échéance.
 */

const MAX_BYTES = 200 * 1024 * 1024;
const ACCEPTED_TYPES = ["video/mp4", "video/quicktime"];

function putFile(url: string, file: File, contentType: string, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Envoi refusé par Zernio (code ${xhr.status}).`));
    xhr.onerror = () =>
      reject(new Error("Envoi impossible : connexion interrompue, ou le navigateur a bloqué l'envoi vers Zernio (CORS / politique de sécurité)."));
    xhr.send(file);
  });
}

function formatRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expirée";
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) return `${Math.floor(hours / 24)} j ${hours % 24} h`;
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

export function CatalogVideosPanel({
  productId,
  serviceId,
  videos,
}: {
  productId?: string;
  serviceId?: string;
  videos: CatalogVideo[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError("Format non pris en charge : utilisez un fichier MP4 ou MOV.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`Vidéo trop lourde (${Math.round(file.size / 1024 / 1024)} Mo) — ${MAX_BYTES / 1024 / 1024} Mo maximum.`);
      return;
    }

    setBusy(true);
    try {
      setStage("Préparation de l'envoi…");
      const ticket = await requestVideoUploadAction({ fileName: file.name, contentType: file.type, sizeBytes: file.size });
      if (!ticket.ok) throw new Error(ticket.error);

      setStage("Envoi de la vidéo vers Zernio…");
      setProgress(0);
      await putFile(ticket.data.uploadUrl, file, ticket.data.contentType, setProgress);

      setStage("Enregistrement…");
      const saved = await registerVideoAction({
        publicUrl: ticket.data.publicUrl,
        storageKey: ticket.data.key,
        contentType: ticket.data.contentType,
        sizeBytes: file.size,
        title: title.trim() || file.name.replace(/\.[^.]+$/, ""),
        productId: productId ?? null,
        serviceId: serviceId ?? null,
      });
      if (!saved.ok) throw new Error(saved.error);

      setTitle("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Envoi impossible.");
    } finally {
      setBusy(false);
      setProgress(null);
      setStage(null);
    }
  }

  async function remove(videoId: string) {
    if (!window.confirm("Retirer cette vidéo du catalogue et de la vitrine ?")) return;
    setError(null);
    const result = await deleteVideoAction(videoId);
    if (!result.ok) setError(result.error);
    else router.refresh();
  }

  return (
    <section className="adm-card flex flex-col gap-4">
      <div>
        <p className="adm-eyebrow">Vidéos</p>
        <h3 className="mt-1 adm-heading-2">Vidéos de présentation</h3>
      </div>

      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="note">
        <p className="font-semibold">Zernio ne conserve vos vidéos que 7 jours.</p>
        <p className="mt-1 text-xs leading-5">
          Passé ce délai, l&apos;envoi temporaire expire : la vidéo disparaît automatiquement de votre catalogue et de votre page d&apos;accueil, et
          aucune publication vidéo ne peut être programmée au-delà de cette échéance (Zernio recommande de programmer dans les 7 jours suivant
          l&apos;envoi). Pour la prolonger, retéléversez simplement la vidéo.
        </p>
      </div>

      {videos.length === 0 ? (
        <p className="text-sm text-slate-500">Aucune vidéo pour l&apos;instant.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {videos.map((video) => (
            <li key={video.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-navy-900/10 p-3">
              {video.expired ? (
                <div className="grid h-20 w-36 shrink-0 place-items-center rounded-lg bg-slate-100 text-xs text-slate-500">Fichier supprimé</div>
              ) : (
                <video src={video.url} controls preload="metadata" playsInline className="h-20 w-36 shrink-0 rounded-lg bg-black object-cover" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-navy-900">{video.title ?? "Vidéo"}</p>
                <p className="text-xs" suppressHydrationWarning>
                  {video.expired ? (
                    <span className="font-semibold text-red-600">Expirée — retéléversez la vidéo</span>
                  ) : (
                    <span className="text-slate-500">
                      Disponible encore <strong className="text-navy-900">{formatRemaining(video.expiresAt)}</strong> (jusqu&apos;au{" "}
                      {new Date(video.expiresAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })})
                    </span>
                  )}
                </p>
              </div>
              <button type="button" onClick={() => void remove(video.id)} className="text-xs text-red-600 hover:underline">
                Retirer
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 border-t border-navy-900/[0.06] pt-4">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Titre de la vidéo (facultatif)"
          maxLength={120}
          disabled={busy}
          className="rounded-xl border border-navy-900/10 px-3 py-2 text-sm disabled:opacity-50"
        />
        <input ref={inputRef} type="file" accept="video/mp4,video/quicktime" onChange={(event) => void onFile(event)} className="hidden" />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="w-fit rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Envoi en cours…" : "Ajouter une vidéo (MP4 / MOV, 200 Mo max)"}
        </button>

        {busy && (
          <div role="status" className="text-xs text-slate-500">
            <p>{stage}</p>
            {progress !== null && (
              <div className="mt-1 h-2 w-full max-w-xs overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-violet-600 transition-all" style={{ width: `${progress}%` }} />
              </div>
            )}
          </div>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </section>
  );
}
