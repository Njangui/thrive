"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/app/_components/submit-button";

/**
 * Champ de réponse de la messagerie : texte + pièce jointe (📎) + message
 * vocal (🎤).
 *
 * Avant ce composant, la messagerie n'offrait qu'un champ texte : impossible
 * d'envoyer une photo, un PDF ou un vocal, alors que les adaptateurs
 * Zernio/Telegram savaient déjà les transporter.
 *
 * Le fichier (choisi OU enregistré) est placé dans un `<input type="file"
 * name="attachment">` réel : il part avec le `FormData` de la Server Action,
 * sans logique d'envoi parallèle. 4 Mo maximum — limite de corps de
 * requête des fonctions Vercel (voir message-attachment-service.ts).
 */

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_RECORDING_SECONDS = 120;

const FILE_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "application/pdf",
  ".doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv",
].join(",");

// Ordre de préférence : OGG/OPUS puis MP4/AAC sont acceptés par WhatsApp ET
// Telegram ; le WebM (défaut de Chrome) n'est utilisé qu'en dernier recours,
// et WhatsApp le refuse (voir classifyAttachment côté serveur).
const RECORDING_MIME_CANDIDATES = [
  "audio/ogg;codecs=opus",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/webm;codecs=opus",
  "audio/webm",
];

function pickRecordingMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return RECORDING_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

function extensionFor(mimeType: string): string {
  if (mimeType.startsWith("audio/ogg")) return "ogg";
  if (mimeType.startsWith("audio/mp4")) return "m4a";
  return "webm";
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

type RecorderState = "idle" | "recording";

export function ReplyComposer({
  replyAction,
  disabled,
}: {
  replyAction: (formData: FormData) => void;
  disabled: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);

  const [attached, setAttached] = useState<{ name: string; size: number; isVoice: boolean; previewUrl: string | null } | null>(null);
  const [recorderState, setRecorderState] = useState<RecorderState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);

  const clearAttachment = useCallback(() => {
    if (fileInputRef.current) fileInputRef.current.value = "";
    setAttached((current) => {
      if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
      return null;
    });
  }, []);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Nettoyage au démontage : micro relâché, URL d'aperçu libérée.
  useEffect(() => {
    return () => {
      discardRef.current = true;
      if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
      stopTracks();
    };
  }, [stopTracks]);

  function onFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setLocalError(null);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setLocalError(`Fichier trop lourd (${formatSize(file.size)}) — 4 Mo maximum.`);
      event.target.value = "";
      return;
    }
    if (attached?.previewUrl) URL.revokeObjectURL(attached.previewUrl);
    setAttached({ name: file.name, size: file.size, isVoice: false, previewUrl: null });
  }

  async function startRecording() {
    setLocalError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setLocalError("L'enregistrement vocal n'est pas pris en charge par ce navigateur.");
      return;
    }
    try {
      clearAttachment();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickRecordingMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = recorder;
      chunksRef.current = [];
      discardRef.current = false;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const finalType = recorder.mimeType || mimeType || "audio/webm";
        stopTracks();
        setRecorderState("idle");
        if (discardRef.current || chunksRef.current.length === 0) return;

        const blob = new Blob(chunksRef.current, { type: finalType });
        if (blob.size > MAX_BYTES) {
          setLocalError("Le vocal dépasse 4 Mo — enregistrez un message plus court.");
          return;
        }
        const file = new File([blob], `vocal-${Date.now()}.${extensionFor(finalType)}`, { type: finalType });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        if (fileInputRef.current) fileInputRef.current.files = transfer.files;
        setAttached({ name: file.name, size: file.size, isVoice: true, previewUrl: URL.createObjectURL(blob) });
      };

      recorder.start();
      elapsedRef.current = 0;
      setElapsed(0);
      setRecorderState("recording");
      timerRef.current = window.setInterval(() => {
        elapsedRef.current += 1;
        setElapsed(elapsedRef.current);
        // Arrêt automatique à 2 min (≈ 1 Mo en Opus) : reste sous le plafond de 4 Mo.
        if (elapsedRef.current >= MAX_RECORDING_SECONDS) finishRecording();
      }, 1000);
    } catch (error) {
      stopTracks();
      setRecorderState("idle");
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      setLocalError(
        denied
          ? "Accès au micro refusé. Autorisez le micro pour ce site dans les réglages du navigateur, puis réessayez."
          : "Impossible de démarrer l'enregistrement (micro introuvable ou déjà utilisé).",
      );
    }
  }

  function finishRecording() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  }

  function cancelRecording() {
    discardRef.current = true;
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    else stopTracks();
    setRecorderState("idle");
  }

  const recording = recorderState === "recording";

  return (
    <form action={replyAction} className="flex flex-col gap-2 border-t border-navy-900/[0.06] bg-white p-4">
      {attached && (
        <div className="flex items-center gap-3 rounded-xl border border-navy-900/10 bg-[#F8FAFC] px-3 py-2 text-sm">
          <span aria-hidden="true">{attached.isVoice ? "🎤" : "📎"}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-navy-900">{attached.isVoice ? "Message vocal" : attached.name}</p>
            <p className="text-xs text-slate-500">{formatSize(attached.size)}</p>
            {attached.previewUrl && <audio controls src={attached.previewUrl} className="mt-1 h-8 w-full max-w-xs" />}
          </div>
          <button type="button" onClick={clearAttachment} aria-label="Retirer la pièce jointe" className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
      )}

      {localError && <p className="text-xs text-red-600">{localError}</p>}

      <div className="flex items-center gap-2">
        {/* Un seul input fichier pour la pièce jointe ET le vocal enregistré. */}
        <input ref={fileInputRef} type="file" name="attachment" accept={FILE_ACCEPT} onChange={onFileChosen} className="hidden" tabIndex={-1} />
        <input type="hidden" name="isVoiceNote" value={attached?.isVoice ? "1" : "0"} />

        {recording ? (
          <>
            <div className="flex flex-1 items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="status">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" aria-hidden="true" />
              Enregistrement… {formatDuration(elapsed)}
            </div>
            <button type="button" onClick={cancelRecording} className="rounded-xl border border-navy-900/10 px-3 py-3 text-sm text-slate-600 hover:bg-navy-900/5">
              Annuler
            </button>
            <button type="button" onClick={finishRecording} className="rounded-xl bg-red-600 px-4 py-3 text-sm font-medium text-white hover:bg-red-700">
              Terminer
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              aria-label="Joindre un fichier"
              title="Joindre une photo, un document ou une vidéo (4 Mo max)"
              className="rounded-xl border border-navy-900/10 p-3 text-slate-600 hover:bg-navy-900/5 disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => void startRecording()}
              disabled={disabled}
              aria-label="Enregistrer un message vocal"
              title="Enregistrer un message vocal"
              className="rounded-xl border border-navy-900/10 p-3 text-slate-600 hover:bg-navy-900/5 disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
              </svg>
            </button>
            <input
              name="content"
              required={!attached}
              placeholder={attached ? "Ajouter une légende (facultatif)…" : "Répondre..."}
              disabled={disabled}
              className="min-w-0 flex-1 rounded-xl border border-navy-900/10 px-4 py-3 text-sm disabled:opacity-50"
            />
            <SubmitButton
              pendingLabel="Envoi..."
              disabled={disabled}
              className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-50"
            >
              Envoyer
            </SubmitButton>
          </>
        )}
      </div>
    </form>
  );
}
