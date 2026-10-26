"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentAttachment, ApprovalCard, VisibleTool } from "@/domain/ports/agent-runtime-port";
import type { ChatMessage, ChatPart, ChatThread, StreamFrame } from "@/application/services/assistant-chat-service";

/**
 * Chat propriétaire — mobile d'abord. Tout le contenu est rendu en TEXTE BRUT
 * (React échappe) : un message client cité par l'assistant ne peut jamais
 * injecter de HTML ou de lien actif. Aucune clé, aucun PIN n'est conservé hors
 * de l'état du composant ; le PIN n'est jamais enregistré ni journalisé.
 */
const MAX_RECORDING_SECONDS = 120;
const MIC_MIMES = ["audio/ogg;codecs=opus", "audio/mp4", "audio/webm;codecs=opus"];

type Local = ChatMessage & { pending?: boolean };
const RISK_LABEL: Record<string, string> = { read: "Lecture", write_reversible: "Modification", sensitive: "Sensible" };

function newId(): string { return crypto.randomUUID(); }

export function ChatClient({ initialThreads, initialMessages, tools, role }: { initialThreads: ChatThread[]; initialMessages: ChatMessage[]; tools: VisibleTool[]; role: string }) {
  const [threads, setThreads] = useState(initialThreads);
  const [threadId, setThreadId] = useState<string | null>(initialThreads[0]?.id ?? null);
  const [messages, setMessages] = useState<Local[]>(initialMessages);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<AgentAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showThreads, setShowThreads] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages]);

  const loadThread = useCallback(async (id: string) => {
    setError(null);
    const res = await fetch(`/api/dashboard/assistant/threads/${id}`);
    if (!res.ok) { setError("Impossible de charger la conversation."); return; }
    setMessages(((await res.json()) as { messages: ChatMessage[] }).messages);
  }, []);
  function selectThread(id: string) { setThreadId(id); setShowThreads(false); void loadThread(id); }

  async function ensureThread(): Promise<string | null> {
    if (threadId) return threadId;
    const res = await fetch("/api/dashboard/assistant/threads", { method: "POST" });
    if (!res.ok) { setError("Impossible de créer la conversation."); return null; }
    const { thread } = (await res.json()) as { thread: ChatThread };
    setThreads((t) => [thread, ...t]); setThreadId(thread.id); setMessages([]);
    return thread.id;
  }

  async function upload(file: File) {
    setError(null);
    const form = new FormData(); form.set("file", file);
    const res = await fetch("/api/dashboard/assistant/upload", { method: "POST", body: form });
    const body = (await res.json().catch(() => ({}))) as { attachment?: AgentAttachment; error?: string };
    if (!res.ok || !body.attachment) { setError(body.error ?? "Envoi du fichier impossible."); return; }
    setFiles((f) => [...f, body.attachment!].slice(0, 3));
  }

  /**
   * Dictée : transcription → texte dans la zone de saisie (relu et corrigeable avant envoi).
   * Si la transcription n'est pas disponible, repli sur l'ancien comportement (vocal joint).
   */
  async function dictate(file: File) {
    setError(null); setTranscribing(true);
    try {
      const form = new FormData(); form.set("audio", file);
      const res = await fetch("/api/dashboard/assistant/transcribe", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string; reason?: string };
      if (res.ok && body.text) { setText((t) => (t.trim() ? `${t.trim()} ${body.text}` : body.text!).slice(0, 4000)); return; }
      if (body.reason === "unavailable") { await upload(file); return; }
      setError(body.error ?? "Transcription impossible.");
    } catch { setError("Transcription impossible. Vérifiez votre connexion."); }
    finally { setTranscribing(false); }
  }

  async function send() {
    const content = text.trim();
    if (busy || (!content && files.length === 0)) return;
    const id = await ensureThread(); if (!id) return;
    setBusy(true); setError(null);
    const clientMessageId = newId();
    const attachments = files;
    setText(""); setFiles([]);
    const userMsg: Local = { id: `u-${clientMessageId}`, role: "user", content, parts: attachments.map((a) => ({ type: "attachment", ...a })), status: "complete", createdAt: new Date().toISOString() };
    const botMsg: Local = { id: `a-${clientMessageId}`, role: "assistant", content: "", parts: [], status: "streaming", createdAt: new Date().toISOString(), pending: true };
    setMessages((m) => [...m, userMsg, botMsg]);

    const controller = new AbortController(); abortRef.current = controller;
    try {
      const res = await fetch("/api/dashboard/assistant/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadId: id, text: content, clientMessageId, attachments }), signal: controller.signal });
      if (!res.ok || !res.body) { const b = (await res.json().catch(() => ({}))) as { error?: string }; throw new Error(b.error ?? "Erreur de connexion."); }
      const reader = res.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) applyFrame(JSON.parse(line) as StreamFrame, botMsg.id);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message || "Erreur de connexion.");
    } finally {
      setBusy(false); abortRef.current = null;
      setMessages((m) => m.map((x) => (x.id === botMsg.id ? { ...x, status: x.status === "streaming" ? "complete" : x.status, pending: false } : x)));
      void refreshThreads();
    }
  }

  function applyFrame(frame: StreamFrame, botId: string) {
    setMessages((all) => all.map((m) => {
      if (m.id !== botId) return m;
      if (frame.type === "text_delta") return { ...m, content: m.content + frame.text };
      if (frame.type === "tool_status") {
        const exists = m.parts.some((p) => p.type === "tool" && p.callId === frame.callId);
        const parts: ChatPart[] = exists
          ? m.parts.map((p) => (p.type === "tool" && p.callId === frame.callId ? { ...p, status: frame.status } : p))
          : [...m.parts, { type: "tool", callId: frame.callId, tool: frame.tool, label: frame.label, risk: frame.risk, status: frame.status }];
        return { ...m, parts };
      }
      if (frame.type === "approval_required") return { ...m, parts: [...m.parts, { type: "approval", card: frame.card, state: "pending" }] };
      if (frame.type === "error") { setError(frame.message); return { ...m, status: "error", content: m.content || frame.message }; }
      return m;
    }));
  }

  async function refreshThreads() {
    const res = await fetch("/api/dashboard/assistant/threads"); if (res.ok) setThreads(((await res.json()) as { threads: ChatThread[] }).threads);
    // Recharge le fil pour obtenir les ids réels (nécessaires aux approbations).
    if (threadId) await loadThread(threadId);
  }

  async function decide(message: Local, card: ApprovalCard, body: Record<string, unknown>): Promise<string | null> {
    const res = await fetch("/api/dashboard/assistant/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messageId: message.id, pendingActionId: card.pendingActionId, ...body }) });
    const out = (await res.json().catch(() => ({}))) as { ok?: boolean; reason?: string; detail?: { attemptsLeft?: number; stepUpReason?: string }; error?: string };
    if (res.ok) { if (threadId) await loadThread(threadId); return null; }
    if (out.reason === "step_up_failed") {
      if (out.detail?.stepUpReason === "locked") return "PIN verrouillé temporairement. Réessayez plus tard ou validez depuis le lien du tableau de bord.";
      if (out.detail?.stepUpReason === "pin_not_set") return "Aucun PIN défini. Définissez-le dans Équipe > Sécurité.";
      return out.detail?.attemptsLeft !== undefined ? `PIN incorrect. ${out.detail.attemptsLeft} essai(s) restant(s).` : "Validation refusée.";
    }
    if (out.reason === "expired") { if (threadId) await loadThread(threadId); return "Cette demande a expiré."; }
    if (out.reason === "already_decided") { if (threadId) await loadThread(threadId); return "Cette demande a déjà été traitée."; }
    return out.error ?? "Action impossible.";
  }

  async function toggleRecording() {
    if (recording) { recorderRef.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MIC_MIMES.find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop()); if (recTimer.current) clearTimeout(recTimer.current);
        setRecording(false);
        const type = rec.mimeType || "audio/webm";
        const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
        void dictate(new File([new Blob(chunks, { type })], `vocal.${ext}`, { type }));
      };
      recorderRef.current = rec; rec.start(); setRecording(true);
      recTimer.current = setTimeout(() => rec.state === "recording" && rec.stop(), MAX_RECORDING_SECONDS * 1000);
    } catch { setError("Micro inaccessible. Autorisez-le dans votre navigateur."); }
  }

  async function archive(id: string) {
    await fetch(`/api/dashboard/assistant/threads/${id}`, { method: "DELETE" });
    setThreads((t) => t.filter((x) => x.id !== id));
    if (threadId === id) { setThreadId(null); setMessages([]); }
  }

  return (
    <div className="adm-card flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
        <button type="button" className="adm-btn-secondary px-3 py-1.5 text-sm" onClick={() => setShowThreads((v) => !v)} aria-expanded={showThreads}>Conversations</button>
        <button type="button" className="adm-btn-secondary px-3 py-1.5 text-sm" onClick={() => { setThreadId(null); setMessages([]); }}>Nouvelle</button>
        {(role === "owner" || role === "admin") && <Link href="/dashboard/assistant/settings" className="ml-auto text-sm text-slate-500 underline">Réglages</Link>}
        <button type="button" className={`${role === "owner" || role === "admin" ? "" : "ml-auto "}text-sm text-slate-500 underline`} onClick={() => setShowTools((v) => !v)} aria-expanded={showTools}>Ce que je peux faire ({tools.length})</button>
      </header>

      {showThreads && (
        <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto border-b border-slate-200 text-sm">
          {threads.length === 0 && <li className="px-3 py-2 text-slate-500">Aucune conversation.</li>}
          {threads.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-3 py-2">
              <button type="button" className={`min-w-0 flex-1 truncate text-left ${t.id === threadId ? "font-semibold" : ""}`} onClick={() => selectThread(t.id)}>{t.title ?? "Sans titre"}</button>
              <button type="button" aria-label="Archiver la conversation" className="text-slate-400 hover:text-red-600" onClick={() => void archive(t.id)}>✕</button>
            </li>
          ))}
        </ul>
      )}
      {showTools && (
        <div className="max-h-48 overflow-y-auto border-b border-slate-200 px-3 py-2 text-sm">
          <p className="mb-1 text-slate-500">Selon votre rôle ({role}) et les réglages du propriétaire :</p>
          {tools.length === 0 ? <p className="text-slate-500">Aucun outil n&apos;est activé pour le moment.</p> : (
            <ul className="space-y-1">{tools.map((t) => <li key={t.name} className="flex justify-between gap-2"><span>{t.label}</span><span className={`adm-badge ${t.risk === "sensitive" ? "adm-badge-danger" : t.risk === "write_reversible" ? "adm-badge-warning" : "adm-badge-success"}`}>{RISK_LABEL[t.risk]}</span></li>)}</ul>
          )}
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-4" aria-live="polite">
        {messages.length === 0 && <p className="mt-8 text-center text-slate-500">Demandez par exemple : « Quelles commandes sont en attente ? » ou « Ajoute une dépense de 5 000 FCFA ».</p>}
        {messages.map((m) => <Bubble key={m.id} message={m} onDecide={decide} />)}
        <div ref={bottomRef} />
      </div>

      {error && <p role="alert" className="border-t border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2 border-t border-slate-200 px-3 py-2 text-xs">
          {files.map((f, i) => <li key={f.path} className="adm-badge">{f.kind === "audio" ? "🎤" : f.kind === "image" ? "🖼" : "📄"} {f.name}<button type="button" aria-label={`Retirer ${f.name}`} className="ml-1" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))}>✕</button></li>)}
        </ul>
      )}
      <form className="flex items-end gap-2 border-t border-slate-200 p-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label className="adm-btn-secondary cursor-pointer px-3 py-2" title="Joindre une photo ou un PDF">
          📎<input type="file" className="sr-only" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
        </label>
        <button type="button" className={`adm-btn-secondary px-3 py-2 ${recording ? "animate-pulse text-red-600" : ""}`} onClick={() => void toggleRecording()} aria-pressed={recording} aria-label={recording ? "Arrêter l'enregistrement" : "Dicter un message"} disabled={transcribing}>{recording ? "■" : transcribing ? "…" : "🎤"}</button>
        <textarea className="adm-input max-h-32 min-h-[2.5rem] flex-1 resize-none" rows={1} maxLength={4000} placeholder="Écrivez à votre assistant…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        {busy ? <button type="button" className="adm-btn-secondary px-3 py-2" onClick={() => abortRef.current?.abort()}>Stop</button> : <button type="submit" className="adm-btn-primary px-4 py-2" disabled={!text.trim() && files.length === 0}>Envoyer</button>}
      </form>
    </div>
  );
}

function Bubble({ message, onDecide }: { message: Local; onDecide: (m: Local, c: ApprovalCard, body: Record<string, unknown>) => Promise<string | null> }) {
  const mine = message.role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[88%] space-y-2 rounded-2xl px-3 py-2 text-sm ${mine ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-900"}`}>
        {message.parts.map((p, i) => {
          if (p.type === "tool") return <p key={p.callId} className="text-xs opacity-70">{p.status === "running" ? "⏳" : p.status === "failed" ? "⚠️" : "✓"} {p.label}</p>;
          if (p.type === "attachment") return p.kind === "image" && p.url ? <img key={i} src={p.url} alt={p.name} className="max-h-48 rounded-lg" /> : <p key={i} className="text-xs opacity-80">{p.kind === "audio" ? "🎤" : "📄"} {p.name}</p>;
          return <ApprovalView key={p.card.pendingActionId} message={message} card={p.card} state={p.state} onDecide={onDecide} />;
        })}
        {message.content && <p className="whitespace-pre-wrap break-words">{message.content}</p>}
        {message.pending && !message.content && message.parts.length === 0 && <p className="opacity-60">…</p>}
      </div>
    </div>
  );
}

const STATE_LABEL: Record<string, string> = { approved: "Validée", rejected: "Refusée", expired: "Expirée", failed: "Échec", replaced: "Remplacée" };

function ApprovalView({ message, card, state, onDecide }: { message: Local; card: ApprovalCard; state: string; onDecide: (m: Local, c: ApprovalCard, body: Record<string, unknown>) => Promise<string | null> }) {
  const [pin, setPin] = useState(""); const [edits, setEdits] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false); const [msg, setMsg] = useState<string | null>(null); const [working, setWorking] = useState(false);
  const needsPin = Boolean(card.stepUp?.allowedMethods.includes("pin"));
  const needsLinkOnly = Boolean(card.stepUp && !needsPin);
  const run = async (body: Record<string, unknown>) => { setWorking(true); setMsg(await onDecide(message, card, body)); setWorking(false); setPin(""); };
  const settled = state !== "pending";

  return (
    <div className="rounded-xl border border-slate-300 bg-white p-3 text-slate-900">
      <div className="flex items-center justify-between gap-2"><p className="font-semibold">{card.title}</p><span className={`adm-badge ${card.risk === "sensitive" ? "adm-badge-danger" : "adm-badge-warning"}`}>{RISK_LABEL[card.risk]}</span></div>
      <p className="mt-1">{card.summary}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">{card.details.map((d) => <div key={d.label} className="contents"><dt className="text-slate-500">{d.label}</dt><dd className="break-words">{d.value}</dd></div>)}</dl>
      {settled ? <p className="mt-2 text-xs font-medium">{STATE_LABEL[state] ?? state}</p> : (
        <div className="mt-3 space-y-2">
          {editing && card.editableFields?.map((f) => <label key={f.name} className="block text-xs">{f.label}<input className="adm-input mt-1 w-full" type={f.type === "number" ? "number" : "text"} inputMode={f.type === "number" ? "decimal" : undefined} maxLength={500} defaultValue={f.value} onChange={(e) => setEdits((x) => ({ ...x, [f.name]: e.target.value }))} /></label>)}
          {needsPin && !editing && <input className="adm-input w-full" type="password" inputMode="numeric" autoComplete="off" pattern="\d{6,8}" maxLength={8} placeholder="Votre PIN (6 à 8 chiffres)" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />}
          {needsLinkOnly && <p className="text-xs text-slate-600">Cette action se valide depuis le lien envoyé dans votre tableau de bord.</p>}
          <div className="flex flex-wrap gap-2">
            {editing ? <button type="button" className="adm-btn-primary px-3 py-1.5" disabled={working || Object.keys(edits).length === 0} onClick={() => void run({ decision: "edit", edits })}>Soumettre la modification</button>
              : <button type="button" className="adm-btn-primary px-3 py-1.5" disabled={working || needsLinkOnly || (needsPin && pin.length < 6)} onClick={() => void run({ decision: "approve", ...(needsPin ? { pin } : {}) })}>Valider</button>}
            {card.editableFields && card.editableFields.length > 0 && <button type="button" className="adm-btn-secondary px-3 py-1.5" disabled={working} onClick={() => setEditing((v) => !v)}>{editing ? "Annuler" : "Modifier"}</button>}
            <button type="button" className="adm-btn-secondary px-3 py-1.5" disabled={working} onClick={() => void run({ decision: "reject" })}>Refuser</button>
          </div>
          <p className="text-[11px] text-slate-500">Expire à {new Date(card.expiresAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</p>
        </div>
      )}
      {msg && <p role="alert" className="mt-2 text-xs text-red-700">{msg}</p>}
    </div>
  );
}
